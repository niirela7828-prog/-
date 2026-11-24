// פתק עבודה – גרסת Google Sheets
// כל פתק שנשלח נשמר כשורה חדשה בלשונית "פתקים" בגיליון.

// ===== שדות הטופס – משנים רק כאן =====
// type: text | date | time | number | textarea
var FIELDS = [
  { name: 'worker',    type: 'text',     required: true,  he: 'שם העובד',     th: 'ชื่อพนักงาน' },
  { name: 'date',      type: 'date',     required: true,  he: 'תאריך',        th: 'วันที่' },
  { name: 'site',      type: 'text',     required: false, he: 'מקום העבודה',  th: 'สถานที่ทำงาน' },
  { name: 'start',     type: 'time',     required: false, he: 'שעת התחלה',    th: 'เวลาเริ่มงาน' },
  { name: 'end',       type: 'time',     required: false, he: 'שעת סיום',     th: 'เวลาเลิกงาน' },
  { name: 'work',      type: 'textarea', required: true,  he: 'תיאור העבודה', th: 'รายละเอียดงาน' },
  { name: 'materials', type: 'textarea', required: false, he: 'חומרים',       th: 'วัสดุที่ใช้' },
  { name: 'notes',     type: 'textarea', required: false, he: 'הערות',        th: 'หมายเหตุ' }
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
    var header = ['נשלח בתאריך', 'שפת המילוי'].concat(FIELDS.map(function (f) { return f.he; }));
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
