import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalValue, parseReminderDisplay, parseReminderTimeText, formatReminderDisplay, formatReminderTimeDisplay, partsToLocalValue, defaultReminderParts, daysInMonth } from '../lib/task-date-picker.ts';
test('companion picker round-trips local dates, 12-hour time and Jira date-only values',()=>{
 for(const local of ['2026-12-25T00:07','2026-12-25T12:07','2026-12-25T23:59']){const parts=parseLocalValue(local);assert.equal(partsToLocalValue(parseReminderDisplay(formatReminderDisplay(parts))),local);}
 assert.equal(formatReminderDisplay(parseLocalValue('2026-12-25T00:07')),'25/12/2026, 12:07 AM');
 assert.equal(formatReminderTimeDisplay(parseLocalValue('2026-12-25T12:07')),'12:07 PM');
 assert.equal(partsToLocalValue(parseLocalValue('2026-12-25')),'2026-12-25T09:00');
 assert.equal(partsToLocalValue(parseReminderDisplay('25/12/2026')),'2026-12-25T09:00');
});
test('invalid dates and ambiguous clock values stay uncommitted',()=>{
 for(const text of ['31/02/2026','29/02/2026','25/13/2026','25/12/2026, 13:00 AM','25/12/2026, 00:00 PM','25/12/2026, 09:99 AM','25/12/2026, 24:00','partial'])assert.equal(parseReminderDisplay(text),null,text);
 for(const text of ['13:30 PM','12:60 AM','24:00','bad'])assert.equal(parseReminderTimeText(text),null,text);
 assert.deepEqual(parseReminderTimeText('12:00 AM'),{hour:0,minute:0});assert.deepEqual(parseReminderTimeText('12:00 PM'),{hour:12,minute:0});assert.deepEqual(parseReminderTimeText('9:05 pm'),{hour:21,minute:5});
 assert.equal(daysInMonth(2028,2),29);assert.ok(parseReminderDisplay('29/02/2028'));
});
test('new reminders seed tomorrow at the current clock time across a year boundary',()=>{
 assert.deepEqual(defaultReminderParts(new Date(2026,11,31,23,47)),{year:2027,month:1,day:1,hour:23,minute:47});
});
