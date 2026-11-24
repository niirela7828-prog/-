// פתק עבודה – גרסת Google Sheets
// כל פתק שנשלח נשמר כשורה חדשה בלשונית "פתקים" בגיליון.

// ===== שדות הטופס – משנים רק כאן =====
// השדות תואמים לפתק המודפס.
// type: text | date | time | number | textarea
// half: true = חצי רוחב (שני שדות באותה שורה, כמו בפתק)
var FIELDS = [
  { name: 'num',     type: 'text',     half: true, he: "מס'",        th: 'หมายเลข' },
  { name: 'date',    type: 'date',     half: true, he: 'תאריך',      th: 'วันที่', required: true },
  { name: 'crop',    type: 'text',     half: true, he: 'גידול',      th: 'พืชที่ปลูก' },
  { name: 'plot',    type: 'text',     half: true, he: 'חלקה',       th: 'แปลง' },
  { name: 'tractor', type: 'text',     half: true, he: 'טרקטור',     th: 'รถแทรกเตอร์' },
  { name: 'tool',    type: 'text',     half: true, he: 'כלי',        th: 'อุปกรณ์' },
  { name: 'mat1',    type: 'text',     half: true, he: 'חומר 1',     th: 'สาร 1' },
  { name: 'qty1',    type: 'text',     half: true, he: 'כמות',       th: 'ปริมาณ', col: 'כמות 1' },
  { name: 'mat2',    type: 'text',     half: true, he: 'חומר 2',     th: 'สาร 2' },
  { name: 'qty2',    type: 'text',     half: true, he: 'כמות',       th: 'ปริมาณ', col: 'כמות 2' },
  { name: 'mat3',    type: 'text',     half: true, he: 'חומר 3',     th: 'สาร 3' },
  { name: 'qty3',    type: 'text',     half: true, he: 'כמות',       th: 'ปริมาณ', col: 'כמות 3' },
  { name: 'start',   type: 'time',     half: true, he: 'שעת התחלה',  th: 'เวลาเริ่มงาน' },
  { name: 'end',     type: 'time',     half: true, he: 'שעת סיום',   th: 'เวลาเลิกงาน' },
  { name: 'total',   type: 'number',              he: 'סה"כ שעות',  th: 'รวมชั่วโมง' },
  { name: 'notes',   type: 'textarea',            he: 'הערות',      th: 'หมายเหตุ' }
];

var SHEET_NAME = 'פתקים';
var MAX_FIELD = 4000;

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.fieldsJson = JSON.stringify(FIELDS);
  return t.evaluate()
    .setTitle('פתק עבודה')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME, 0);
    var header = ['נשלח בתאריך', 'שפת המילוי'].concat(FIELDS.map(function (f) { return f.col || f.he; }));
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setRightToLeft(true);
  }
  return sheet;
}

// Prevent text that starts with = + - @ from being run as a spreadsheet formula.
function clean_(value) {
  var s = String(value == null ? '' : value).trim().slice(0, MAX_FIELD);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function submitNote(data, lang) {
  data = data || {};
  for (var i = 0; i < FIELDS.length; i++) {
    var f = FIELDS[i];
    if (f.required && !String(data[f.name] || '').trim()) {
      throw new Error('missing');
    }
  }
  var filled = FIELDS.some(function (f) { return f.type !== 'date' && String(data[f.name] || '').trim(); });
  if (!filled) throw new Error('empty');
  var row = [new Date(), lang === 'th' ? 'ไทย' : 'עברית']
    .concat(FIELDS.map(function (f) { return clean_(data[f.name]); }));

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    getSheet_().appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// מריצים פעם אחת מתוך עורך הסקריפט כדי ליצור את הלשונית ולאשר הרשאות.
function setup() {
  getSheet_();
}
