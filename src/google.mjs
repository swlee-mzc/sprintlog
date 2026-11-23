import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cells, colLetter } from './cells.mjs';
import { weekKey, weekLabel, weeklyColumns, cellValue } from './weekly-sheet.mjs';
import { readLocal } from './local.mjs';
import { sheetIdFromUrl } from './profile.mjs';
import { weekDays, assertDate } from './core/time.mjs';
import { EXIT, Failure } from './core/runtime.mjs';

const fail = (message) => new Failure(EXIT.PRECONDITION, message);

export async function googleAccessToken(fetchImpl = fetch) {
  if (process.env.SPRINTLOG_GOOGLE_ACCESS_TOKEN) return process.env.SPRINTLOG_GOOGLE_ACCESS_TOKEN;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.config/gcloud/application_default_credentials.json');
  if (!existsSync(path)) throw fail('Google API 인증 없음 — references/google-api.md의 OAuth 설정을 완료하세요');
  let adc;
  try { adc = JSON.parse(readFileSync(path, 'utf8')); } catch { throw fail('Google ADC 파일을 읽을 수 없습니다'); }
  if (adc.type !== 'authorized_user' || !adc.refresh_token || !adc.client_id || !adc.client_secret) throw fail('사용자 OAuth ADC가 필요합니다 — references/google-api.md 참고');
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token }),
  });
  if (!response.ok) throw fail(`Google OAuth 갱신 실패 (HTTP ${response.status}) — 재인증이 필요합니다`);
  const data = await response.json();
  if (!data.access_token) throw fail('Google OAuth 응답에 access token이 없습니다');
  return data.access_token;
}

// Read saved, approved local weeks. No browser state or URL gid is used.
export async function syncSheets(profile, { weeks, apply = false, replace = false }, { fetchImpl = fetch, token, read = readLocal } = {}) {
  const mondays = [...new Set(weeks.map((w) => weekDays(assertDate(w))[0]))];
  if (!mondays.length) throw new Failure(EXIT.INPUT, '반영할 주차가 필요합니다');
  const saved = mondays.map((week) => {
    const value = read(profile, week);
    if (!value.notation) throw fail(`확정된 로컬 주간 로그가 없습니다: ${week}`);
    return { week, notation: value.notation, revision: value.revision };
  });
  const url = profile.sheet.format === 'xlsx' ? profile.sheet.workUrl : profile.sheet.url;
  if (!url) throw fail('Google Sheets 작업본 URL이 필요합니다');
  const id = sheetIdFromUrl(url);
  const accessToken = token ?? await googleAccessToken(fetchImpl);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  const request = async (suffix, body) => {
    let response;
    try {
      response = await fetchImpl(base + suffix, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw fail(body ? 'Google API 쓰기 결과 불명 — 같은 주차를 dry-run으로 재조회한 뒤 판단하세요. 자동 재전송하지 않습니다' : 'Google API 조회 실패');
    }
    if (!response.ok) {
      let reason = '';
      try {
        const error = (await response.json()).error;
        const code = error?.details?.find((d) => d.reason)?.reason;
        if (/^[A-Z_]+$/.test(code ?? '')) reason = ` ${code}`;
      } catch { /* HTTP status remains the diagnostic when no structured error exists. */ }
      throw fail(`Google Sheets API 실패 (HTTP ${response.status}${reason}) — 계정·Sheets scope·API 활성화를 확인하세요`);
    }
    return response.json();
  };
  const query = (params) => '?' + new URLSearchParams(params);
  const meta = await request(query({ fields: 'sheets.properties(sheetId,title,gridProperties)' }));
  const title = profile.sheet.tabName ?? '주간 로그';
  const sheet = meta.sheets?.find((s) => s.properties.title === title)?.properties;
  if (!sheet) throw fail(`사용자별 고정 탭을 찾을 수 없습니다: ${title}`);
  const targets = saved.sort((a, b) => a.week.localeCompare(b.week)).map((value) => ({ ...value, sheet }));
  let nextRow = 0;
  const readTarget = async (target) => {
    const headerRow = profile.sheet.headerRow ?? 1;
    const lastColumn = colLetter(Math.min(25, (sheet.gridProperties?.columnCount ?? 26) - 1));
    const quoted = `'${sheet.title.replace(/'/g, "''")}'`;
    const data = await request(query({ ranges: `${quoted}!A1:${lastColumn}`, includeGridData: 'true', fields: 'sheets(properties(sheetId,title),data(startRow,startColumn,rowMetadata(pixelSize),rowData(values(userEnteredValue,effectiveValue,formattedValue,textFormatRuns,userEnteredFormat.textFormat))))' }));
    const tab = data.sheets?.find((s) => s.properties.sheetId === sheet.sheetId);
    if (!tab) throw fail(`조회된 탭 ID가 일치하지 않습니다: ${sheet.title}`);
    const rows = [], heights = [];
    for (const grid of tab.data ?? []) {
      for (const [i, height] of (grid.rowMetadata ?? []).entries()) heights[(grid.startRow ?? 0) + i] = height?.pixelSize;
      for (const [i, row] of (grid.rowData ?? []).entries()) {
        rows[(grid.startRow ?? 0) + i] ??= [];
        for (const [j, cell] of (row.values ?? []).entries()) rows[(grid.startRow ?? 0) + i][(grid.startColumn ?? 0) + j] = cell;
      }
    }
    const header = (rows[headerRow - 1] ?? []).map(cellValue);
    const columns = weeklyColumns(header, target.notation.week.days);
    const matches = [];
    let last = headerRow - 1;
    for (let i = headerRow; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (row.some((c) => c?.userEnteredValue || cellValue(c))) last = i;
      if (weekKey(cellValue(row[columns.week])) === target.week) matches.push(i);
    }
    if (matches.length > 1) throw fail(`주차 행이 중복됩니다: ${target.week}`);
    const missing = matches.length === 0;
    if (target.rowIndex === undefined) {
      target.rowIndex = matches[0] ?? Math.max(last + 1, nextRow);
      if (missing) nextRow = target.rowIndex + 1;
    }
    if (!missing && matches[0] !== target.rowIndex) throw fail('주차 행 위치가 변경되었습니다. 다시 미리보기 하세요');
    const rowIndex = target.rowIndex, row = rows[rowIndex] ?? [];
    if (missing && row.some((c) => c?.userEnteredValue || cellValue(c))) throw fail('추가할 주차 행에 기존 내용이 있습니다');
    const current = row.map(cellValue);
    const currentRuns = row.map((cell) => {
      const baseFormat = cell?.userEnteredFormat?.textFormat ?? {};
      return cell?.textFormatRuns?.length ? cell.textFormatRuns.map((r) => ({ ...r, format: { ...baseFormat, ...r.format } })) : [{ startIndex: 0, format: baseFormat }];
    });
    const plan = cells({ notation: target.notation, sheet, profile: { ...profile.sheet, ticketBase: null }, header, names: [], rowIndex, columns, current, currentRuns, replace });
    if (plan.error) throw fail(`시트 좌표 확인 실패: ${plan.error}`);
    const initialization = [];
    if (missing) {
      const template = (profile.sheet.templateRow ?? headerRow + 1) - 1;
      if (template < headerRow || template >= (sheet.gridProperties?.rowCount ?? rows.length)) throw fail('유효한 본문 템플릿 행이 필요합니다');
      if (rowIndex !== template) {
        const width = Math.max(...Object.values(columns)) + 1;
        initialization.push({ copyPaste: { source: { sheetId: sheet.sheetId, startRowIndex: template, endRowIndex: template + 1, startColumnIndex: 0, endColumnIndex: width }, destination: { sheetId: sheet.sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: width }, pasteType: 'PASTE_FORMAT' } });
        if (heights[template] !== undefined) initialization.push({ updateDimensionProperties: { range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 }, properties: { pixelSize: heights[template] }, fields: 'pixelSize' } });
      }
      initialization.push({ updateCells: { start: { sheetId: sheet.sheetId, rowIndex, columnIndex: columns.week }, rows: [{ values: [{ userEnteredValue: { stringValue: weekLabel(target.week) } }] }], fields: 'userEnteredValue' } });
    }
    return { plan, initialization, state: JSON.stringify({ header, rows, heights }) };
  };
  const before = [];
  for (const target of targets) before.push(await readTarget(target));
  const requests = before.flatMap((t) => [...t.initialization, ...t.plan.requests]);
  const neededRows = Math.max(...targets.map((t) => t.rowIndex + 1));
  if (neededRows > (sheet.gridProperties?.rowCount ?? neededRows)) requests.unshift({ appendDimension: { sheetId: sheet.sheetId, dimension: 'ROWS', length: neededRows - sheet.gridProperties.rowCount } });
  if (!apply) return { stage: 'google-preview', changed: requests.length, weeks: before.map((t) => t.plan) };
  // Preflight every week before the single batch mutation. Do not retry an uncertain write.
  for (const [i, target] of targets.entries()) {
    if (read(profile, target.week).revision !== target.revision) throw fail('로컬 파일이 변경되었습니다. 다시 미리보기 하세요');
    if ((await readTarget(target)).state !== before[i].state) throw fail(`Google 시트가 변경되었습니다: ${target.sheet.title}. 다시 미리보기 하세요`);
  }
  if (requests.length) await request(':batchUpdate', { requests });
  const verified = [];
  for (const target of targets) {
    const after = await readTarget(target);
    if (after.initialization.length || after.plan.requests.length) throw fail(`Google 값·굵게·취소선·링크 검증 실패: ${target.sheet.title}. 자동 재전송하지 않습니다`);
    verified.push({ week: target.week, tab: target.sheet.title, row: after.plan.row });
  }
  return { stage: 'google-verified', changed: requests.length, weeks: verified };
}
