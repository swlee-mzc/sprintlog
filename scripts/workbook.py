"""Local workbook storage. Google delivery exports contain weekly cells only."""
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
        runs.append(TextBlock(InlineFont(strike=item['strike']), text))
    if sum(len(r.text) for r in runs) > 32767:
        raise ValueError('Excel 셀의 최대 글자 수를 넘습니다')
    return CellRichText(runs) if runs else ''


def day(value, year):
    if isinstance(value, (dt.datetime, dt.date)):
        return value.date() if isinstance(value, dt.datetime) else value
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})(?: [월화수목금])?', str(value or ''))
    return dt.date(year, int(m[1]), int(m[2])) if m else None


def weeks(book):
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


def week_value(found):
    sheet, row, dates = found
    days = [d.isoformat() for d in dates]
    return {'week': {'days': days, 'next': {'from': (dates[0] + dt.timedelta(days=7)).isoformat(), 'to': (dates[0] + dt.timedelta(days=11)).isoformat()}}, 'cells': {d: entries(sheet.cell(row + 1, c).value, sheet.cell(row + 1, c).font.strike) for c, d in enumerate(days, 2)}, 'next': entries(sheet.cell(row + 1, 7).value, sheet.cell(row + 1, 7).font.strike)}


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
    global BULLET
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
        for c, d in enumerate(value['week']['days'], 1):
            text(sheet.cell(1, c), d)
            sheet.cell(2, c).value = rich(value['cells'][d], req['bullet'], req['tickets'])
            style(sheet.cell(2, c))
        text(sheet.cell(1, 6), '차주 계획')
        sheet.cell(2, 6).value = rich(value['next'], req['bullet'], req['tickets'])
        style(sheet.cell(2, 6))
        for c in 'ABCDEF':
            sheet.column_dimensions[c].width = 58
        sheet.row_dimensions[2].height = 230
        target = Path(req['output'])
        def verify(loaded):
            assert loaded.sheetnames == ['전달']
            for c in range(1, 7):
                assert str(loaded.active.cell(2, c).value or '') == str(sheet.cell(2, c).value or '')
        save_checked(delivery, target, revision(target), verify)
        return {'file': str(target), 'range': "'전달'!A2:F2", 'notation': value, 'sourceRevision': before}
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
        if start in existing:
            sheet, row, dates = existing[start]
        else:
            year = start[:4]
            if year not in book.sheetnames:
                sheet = book.create_sheet(year, 0)
                text(sheet.cell(1, 1), year + ' 스프린트 로그')
                sheet.freeze_panes = 'B4'
                sheet.column_dimensions['A'].width = 22
                for col in 'BCDEFG':
                    sheet.column_dimensions[col].width = 58
            sheet = book[year]
            row = max(4, sheet.max_row + 2)
            dates = [dt.date.fromisoformat(d) for d in value['week']['days']]
            text(sheet.cell(row, 1), '주간')
            text(sheet.cell(row + 1, 1), start)
            for c, date in enumerate(dates, 2):
                sheet.cell(row, c).value = date
                sheet.cell(row, c).number_format = 'mm/dd'
                style(sheet.cell(row, c), True)
            text(sheet.cell(row, 7), '차주 계획')
            style(sheet.cell(row, 7), True)
        for c, key in enumerate([d.isoformat() for d in dates] + ['next'], 2):
            new = value['next'] if key == 'next' else value['cells'][key]
            if new is None:
                continue
            target = sheet.cell(row + 1, c)
            updated = merge(entries(target.value, target.font.strike), new)
            target.value = rich(updated, req['bullet'], req['tickets'])
            target.alignment = Alignment(wrap_text=True, vertical='top')
        sheet.row_dimensions[row + 1].height = 230
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
