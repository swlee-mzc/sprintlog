"""Local workbook storage. Google delivery exports contain weekly cells only."""
from copy import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from openpyxl import Workbook, load_workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.styles import Alignment, Font, PatternFill


def revision(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


BULLET = '- '


def entries(value, cell_strike=False):
    if value is None:
        return []
    parts = []
    if isinstance(value, CellRichText):
        for p in value:
            parts.append((p.text, bool(p.font.strike)) if isinstance(p, TextBlock) else (str(p), False))
    else:
        parts = [(str(value), bool(cell_strike))]
    lines = [[]]
    for text, strike in parts:
        for i, chunk in enumerate(text.split('\n')):
            if i:
                lines.append([])
            if chunk:
                lines[-1].append((chunk, strike))
    result = []
    for chunks in lines:
        text = ''.join(t for t, _ in chunks)
        if not text:
            continue
        text = text[len(BULLET):] if BULLET and text.startswith(BULLET) else re.sub(r'^- ', '', text)
        key = re.search(r' \(([A-Za-z][A-Za-z0-9_]*-\d+)\)$', text)
        if key:
            text = text[:key.start()]
        kind = 'delayed' if text.startswith('[완료-지연(') else 'due' if text.startswith('[완료]') else 'progress'
        result.append({'kind': kind, 'text': text, 'strike': kind in ('due', 'delayed') and all(s for t, s in chunks if t.strip()), 'key': key[1] if key else None})
    return result


def rich(items, bullet, tickets):
    runs = []
    for i, item in enumerate(items):
        text = ('\n' if i else '') + bullet + item['text']
        if tickets and item.get('key'):
            text += ' (' + item['key'] + ')'
        if i:
            runs.append(TextBlock(InlineFont(strike=False), '\n'))
            text = text[1:]
        tag = re.match(r'\[완료(?:-지연\(\d{4}\))?\]', item['text'])
        if tag:
            start = len(bullet)
            end = start + len(tag[0])
            runs.extend([TextBlock(InlineFont(strike=item['strike'], b=False), text[:start]), TextBlock(InlineFont(strike=item['strike'], b=True), text[start:end])])
            if text[end:]:
                runs.append(TextBlock(InlineFont(strike=item['strike'], b=False), text[end:]))
        else:
            runs.append(TextBlock(InlineFont(strike=item['strike'], b=False), text))
    if sum(len(r.text) for r in runs) > 32767:
        raise ValueError('Excel 셀의 최대 글자 수를 넘습니다')
    return CellRichText(runs) if runs else ''


def day(value, year):
    if isinstance(value, (dt.datetime, dt.date)):
        return value.date() if isinstance(value, dt.datetime) else value
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})(?: [월화수목금])?', str(value or ''))
    return dt.date(year, int(m[1]), int(m[2])) if m else None


def legacy_weeks(book):
    result = {}
    for sheet in book:
        if not re.fullmatch(r'\d{4}', sheet.title):
            continue
        for row in range(1, sheet.max_row):
            first = day(sheet.cell(row, 2).value, int(sheet.title))
            if first is None:
                continue
            dates = [day(sheet.cell(row, c).value, int(sheet.title)) for c in range(2, 7)]
            if first.weekday() != 0 or dates != [first + dt.timedelta(days=i) for i in range(5)]:
                raise ValueError('주간 날짜 열이 월~금과 일치하지 않습니다')
            key = first.isoformat()
            if key in result:
                raise ValueError('중복된 주차: ' + key)
            result[key] = (sheet, row, dates)
    return result


def legacy_week_value(found):
    sheet, row, dates = found
    days = [d.isoformat() for d in dates]
    return {'week': {'days': days, 'next': {'from': (dates[0] + dt.timedelta(days=7)).isoformat(), 'to': (dates[0] + dt.timedelta(days=11)).isoformat()}}, 'cells': {d: entries(sheet.cell(row + 1, c).value, sheet.cell(row + 1, c).font.strike) for c, d in enumerate(days, 2)}, 'next': entries(sheet.cell(row + 1, 7).value, sheet.cell(row + 1, 7).font.strike), 'issues': str(sheet.cell(row + 1, 8).value or '') if sheet.cell(row, 8).value == '이슈·요청' else ''}


HEADERS = ['주차', '월', '화', '수', '목', '금', '차주 계획', '이슈·요청']
TAB = '주간 로그'


def weeks(book):
    if TAB not in book.sheetnames:
        return legacy_weeks(book)
    sheet = book[TAB]
    if [sheet.cell(1, c).value for c in range(1, 9)] != HEADERS:
        raise ValueError('주간 로그 탭의 헤더가 예상한 형식이 아닙니다')
    result = {}
    for row in range(2, sheet.max_row + 1):
        value = sheet.cell(row, 1).value
        if not value:
            if any(sheet.cell(row, c).value for c in range(2, 9)):
                raise ValueError('내용이 있지만 주차 키가 없는 행이 있습니다')
            continue
        key = str(value).splitlines()[0].strip()
        first = dt.date.fromisoformat(key)
        if first.weekday() != 0 or key in result:
            raise ValueError('월요일이 아닌 주차 또는 중복 주차: ' + key)
        result[key] = (sheet, row, [first + dt.timedelta(days=i) for i in range(5)])
    return result


def week_value(found):
    sheet, row, dates = found
    if sheet.title != TAB:
        return legacy_week_value(found)
    days = [d.isoformat() for d in dates]
    return {'week': {'days': days, 'next': {'from': (dates[0] + dt.timedelta(days=7)).isoformat(), 'to': (dates[0] + dt.timedelta(days=11)).isoformat()}}, 'cells': {d: entries(sheet.cell(row, c).value, sheet.cell(row, c).font.strike) for c, d in enumerate(days, 2)}, 'next': entries(sheet.cell(row, 7).value, sheet.cell(row, 7).font.strike), 'issues': str(sheet.cell(row, 8).value or '')}


def ensure_fixed(book, path):
    if TAB in book.sheetnames:
        return book[TAB]
    old = legacy_weeks(book)
    if old and path.exists():
        backup = path.with_name(path.name + '.pre-fixed.bak')
        if not backup.exists():
            with backup.open('xb') as out:
                out.write(path.read_bytes())
            os.chmod(backup, 0o600)
    sheet = book.create_sheet(TAB, 0)
    for col, label in enumerate(HEADERS, 1):
        text(sheet.cell(1, col), label)
        style(sheet.cell(1, col), True)
    sheet.freeze_panes = 'B2'
    sheet.row_dimensions[1].height = 22
    sheet.column_dimensions['A'].width = 22
    for col in 'BCDEFGH':
        sheet.column_dimensions[col].width = 58
    for week, found in old.items():
        row = append_week(sheet, week)
        value = legacy_week_value(found)
        for col, items in enumerate(list(value['cells'].values()) + [value['next']], 2):
            sheet.cell(row, col).value = rich(items, BULLET, True)
        text(sheet.cell(row, 8), value['issues'])
    # The pre-migration backup retains the original tabs and formatting.
    legacy_names = {found[0].title for found in old.values()}
    for name in list(book.sheetnames):
        if name in legacy_names or (re.fullmatch(r'\d{4}-\d{2}-\d{2}', name) and book[name].cell(1, 1).value == '팀원'):
            del book[name]
    return sheet


def append_week(sheet, week):
    last = max((r for r in range(1, sheet.max_row + 1) if any(sheet.cell(r, c).value is not None for c in range(1, 9))), default=1)
    row = max(2, last + 1)
    if row > 2:
        for col in range(1, 9):
            sheet.cell(row, col)._style = copy(sheet.cell(2, col)._style)
        sheet.row_dimensions[row] = copy(sheet.row_dimensions[2])
        sheet.row_dimensions[row].index = row
    else:
        for col in range(1, 9):
            style(sheet.cell(row, col))
        sheet.row_dimensions[row].height = 72
    first = dt.date.fromisoformat(week)
    text(sheet.cell(row, 1), week + '\n' + first.strftime('%m/%d') + ' ~ ' + (first + dt.timedelta(days=4)).strftime('%m/%d'))
    return row


def unscheduled(book):
    if 'unscheduled' not in book.sheetnames:
        return []
    sheet = book['unscheduled']
    if [sheet.cell(4, c).value for c in range(1, 4)] != ['업무', '상태', '메모']:
        raise ValueError('unscheduled 탭의 머리행이 예상한 형식이 아닙니다')
    return [{'title': str(sheet.cell(r, 1).value), 'status': str(sheet.cell(r, 2).value or ''), 'note': str(sheet.cell(r, 3).value or '')} for r in range(5, sheet.max_row + 1) if sheet.cell(r, 1).value]


def style(cell, header=False):
    cell.font = Font(name='맑은 고딕', size=11, bold=header)
    cell.alignment = Alignment(wrap_text=True, vertical='top')
    if header:
        cell.fill = PatternFill('solid', fgColor='E6EEF7')


def text(cell, value):
    cell.value = value
    if isinstance(value, str):
        cell.data_type = 's'  # User memos beginning with '=' remain text.


def write_unscheduled(book, items):
    if 'unscheduled' not in book.sheetnames:
        sheet = book.create_sheet('unscheduled')
        text(sheet.cell(1, 1), '미배정 업무 · 로컬 보관 전용')
        text(sheet.cell(2, 1), 'Jira 및 Google 주간 시트에 연결하지 않습니다.')
        for c, value in enumerate(['업무', '상태', '메모'], 1):
            text(sheet.cell(4, c), value)
            style(sheet.cell(4, c), True)
    sheet = book['unscheduled']
    for r, item in enumerate(items, 5):
        for c, key in enumerate(['title', 'status', 'note'], 1):
            text(sheet.cell(r, c), item.get(key, ''))
            style(sheet.cell(r, c))
        sheet.row_dimensions[r].height = 58
    for c, width in [('A', 58), ('B', 22), ('C', 85)]:
        sheet.column_dimensions[c].width = width
    sheet.freeze_panes = 'A5'


def merge(old, new):
    by_key = {e.get('key') or e['text']: e for e in old}
    for item in new:
        by_key[item.get('key') or item['text']] = item
    return list(by_key.values())


def save_checked(book, path, expected, verify):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(prefix='.sprintlog-', suffix='.xlsx', dir=path.parent)
    os.close(handle)
    try:
        book.save(name)
        loaded = load_workbook(name, rich_text=True)
        verify(loaded)
        loaded.close()
        if revision(path) != expected:
            raise ValueError('저장 중 파일이 변경되었습니다. 다시 읽고 확정하세요')
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def run(req):
    global BULLET, TAB
    TAB = req.get('tabName', '주간 로그')
    BULLET = req['bullet']
    path = Path(req['path'])
    before = revision(path)
    book = load_workbook(path, rich_text=True) if before is not None else Workbook()
    if before is None:
        book.remove(book.active)
    existing = weeks(book)
    items = unscheduled(book)
    week = req.get('week')
    if req['action'] == 'read':
        return {'status': 'ok' if before else 'missing-workbook', 'revision': before, 'weeks': list(existing), 'unscheduled': items, 'notation': week_value(existing[week]) if week in existing else None}
    if req['action'] == 'delivery':
        if week not in existing:
            raise ValueError('확정된 주간 로그가 없습니다')
        delivery = Workbook()
        sheet = delivery.active
        sheet.title = '전달'
        value = week_value(existing[week])
        for col, label in enumerate(HEADERS, 1):
            text(sheet.cell(1, col), label)
            style(sheet.cell(1, col), True)
        text(sheet.cell(2, 1), week)
        for col, items in enumerate(list(value['cells'].values()) + [value['next']], 2):
            sheet.cell(2, col).value = rich(items, req['bullet'], False)
            style(sheet.cell(2, col))
        text(sheet.cell(2, 8), value.get('issues', ''))
        style(sheet.cell(2, 8))
        for col in 'ABCDEFGH':
            sheet.column_dimensions[col].width = 58
        sheet.row_dimensions[2].height = 230
        target = Path(req['output'])
        def verify(loaded):
            assert loaded.sheetnames == ['전달']
            for col in range(1, 9):
                assert str(loaded.active.cell(2, col).value or '') == str(sheet.cell(2, col).value or '')
        save_checked(delivery, target, revision(target), verify)
        return {'file': str(target), 'range': "'전달'!B2:H2", 'notation': value, 'sourceRevision': before}
    if req.get('revision') != before:
        raise ValueError('로컬 파일이 변경되었습니다. 다시 읽고 확정하세요')
    incoming = req.get('unscheduled', [])
    by_title = {i['title']: i for i in items}
    for item in incoming:
        by_title[item['title']] = {**by_title.get(item['title'], {}), **item}
    items = list(by_title.values())
    write_unscheduled(book, items)
    value = req.get('notation')
    saved_week = None
    if value:
        start = value['week']['days'][0]
        sheet = ensure_fixed(book, path)
        existing_fixed = weeks(book)
        row = existing_fixed[start][1] if start in existing_fixed else append_week(sheet, start)
        dates = [dt.date.fromisoformat(d) for d in value['week']['days']]
        for col, key in enumerate([d.isoformat() for d in dates] + ['next'], 2):
            new = value['next'] if key == 'next' else value['cells'][key]
            if new is None:
                continue
            target = sheet.cell(row, col)
            updated = new if req.get('replace') else merge(entries(target.value, target.font.strike), new)
            target.value = rich(updated, req['bullet'], req['tickets'])
        if 'issues' in value:
            text(sheet.cell(row, 8), value['issues'])
        saved_week = week_value((sheet, row, dates))
    def verify(loaded):
        assert unscheduled(loaded) == items
        after = weeks(loaded)
        assert set(existing) <= set(after)
        for key in existing:
            if not value or key != value['week']['days'][0]:
                assert week_value(after[key]) == week_value(existing[key])
        if value:
            assert week_value(after[value['week']['days'][0]]) == saved_week
    save_checked(book, path, before, verify)
    return {'status': 'local-synced', 'path': str(path), 'revision': revision(path), 'weeks': list(weeks(book)), 'unscheduled': items, 'notation': saved_week}


try:
    print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)
