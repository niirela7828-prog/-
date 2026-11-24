// שדות הטופס של פתק העבודה.
// כדי שיתאימו בדיוק לפתק המודפס, משנים רק את הקובץ הזה.
// type: text | date | time | number | textarea
module.exports = [
  { name: 'worker',    type: 'text',     required: true,  he: 'שם העובד',       th: 'ชื่อพนักงาน' },
  { name: 'date',      type: 'date',     required: true,  he: 'תאריך',          th: 'วันที่' },
  { name: 'site',      type: 'text',     required: false, he: 'מקום העבודה',    th: 'สถานที่ทำงาน' },
  { name: 'start',     type: 'time',     required: false, he: 'שעת התחלה',      th: 'เวลาเริ่มงาน' },
  { name: 'end',       type: 'time',     required: false, he: 'שעת סיום',       th: 'เวลาเลิกงาน' },
  { name: 'work',      type: 'textarea', required: true,  he: 'תיאור העבודה',   th: 'รายละเอียดงาน' },
  { name: 'materials', type: 'textarea', required: false, he: 'חומרים',         th: 'วัสดุที่ใช้' },
  { name: 'notes',     type: 'textarea', required: false, he: 'הערות',          th: 'หมายเหตุ' },
];
