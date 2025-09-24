const NAMES_SPREADSHEET_ID = "1UAxip680bg0TiE72jKas_qExCYn7fLEg8nrmH7SnytQ";
const SIGNUP_SPREADSHEET_ID = "1-EZ3PftWUD0zq8zyciYbCUfskuNujBy7FTB-2yEkmoo";

let logBuffer = [];

function logToBuffer(msg) {
  const timestamp = new Date().toISOString();
  const fullMsg = `[${timestamp}] ${msg}`;
  logBuffer.push(fullMsg);
  console.log(fullMsg);
}

function doGet(e) {
  logToBuffer("doGet called");
  const template = HtmlService.createTemplateFromFile('index');
  const output = template.evaluate();
  output.setTitle('Springfield Seniors Signup');
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  logToBuffer("HTML output generated");
  return output;
}

function getLogs() {
  logToBuffer("getLogs called");
  return logBuffer;
}

// Format a date object or string to MM/DD/YYYY
function formatDateToString(date) {
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), "MM/dd/yyyy");
}

function getNames() {
  logToBuffer("getNames called");
  const ss = SpreadsheetApp.openById(NAMES_SPREADSHEET_ID);
  const sheet = ss.getSheets()[0];
  const names = sheet.getRange("A2:A").getValues().flat().filter(name => name);
  logToBuffer(`Found ${names.length} names`);
  return names;
}

function getSignups() {
  logToBuffer("getSignups called");
  const ss = SpreadsheetApp.openById(SIGNUP_SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Sheet1");
  if (!sheet) {
    logToBuffer("Sheet 'Sheet1' not found");
    return [];
  }

  const headerRow = sheet.getRange("1:1").getDisplayValues()[0];
  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  const maxDate = new Date(minDate.getFullYear(), minDate.getMonth() + 3, minDate.getDate());

  const targetCols = [];
  const formattedHeaders = [];

  for (let col = 1; col < headerRow.length; col++) {
    const str = headerRow[col];
    if (!str) continue;
    const parsed = new Date(str);
    if (!isNaN(parsed) && parsed >= minDate && parsed <= maxDate) {
      targetCols.push(col);
      formattedHeaders.push(formatDateToString(parsed));
    }
  }

  if (targetCols.length === 0) return [];

  const names = sheet.getRange("A2:A").getValues().flat();
  const lastRow = names.findLastIndex(name => name) + 2;
  const actualNames = names.slice(0, lastRow - 2);

  const readCols = 1 + Math.max(...targetCols);
  const data = sheet.getRange(2, 1, actualNames.length, readCols).getDisplayValues();

  const signups = [];

  for (let i = 0; i < actualNames.length; i++) {
    const row = data[i];
    const name = row[0];
    if (!name) continue;

    const dateStatus = {};
    targetCols.forEach((colIndex, j) => {
      const value = row[colIndex];
      if (value === true || (typeof value === 'string' && value.toLowerCase() === 'x')) {
        dateStatus[formattedHeaders[j]] = true;
      }
    });

    signups.push({ name, dates: dateStatus });
  }

  logToBuffer(`getSignups completed: ${signups.length} players found`);
  return signups;
}


function loadSignupsForName(name) {
  logToBuffer(`loadSignupsForName called for: ${name}`);
  
  const ss = SpreadsheetApp.openById(SIGNUP_SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Sheet1");
  if (!sheet) throw new Error("Sheet not found");

  const headerRow = sheet.getRange(1, 2, 1, sheet.getLastColumn() - 1).getDisplayValues()[0];
  const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, sheet.getLastColumn() - 1).getDisplayValues();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() + 3); // 3 months into the future

  const signedUpDates = [];

  for (let r = 0; r < data.length; r++) {
    if (sheet.getRange(r + 2, 1).getValue() !== name) continue;
    const row = data[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell) {
        const parts = headerRow[c].split('/');
        if (parts.length !== 3) continue;
        const dateObj = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
        dateObj.setHours(0, 0, 0, 0);
        if (dateObj <= cutoff) {
          signedUpDates.push(headerRow[c]);
        }
      }
    }
  }

  logToBuffer(`Signed-up dates for ${name}: ${signedUpDates.join(", ")}`);
  return signedUpDates;
}


function buildSignupEmailGrid(allDatesByMonth, signupMap, playerName) {
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  function parseMDY(dateStr) {
    const [mm, dd, yyyy] = dateStr.split('/').map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  function getISOWeekNumber(date) {
    const tmp = new Date(date);
    tmp.setHours(0,0,0,0);
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const week1 = new Date(tmp.getFullYear(), 0, 4);
    return 1 + Math.round(((tmp - week1)/86400000 - 3 + ((week1.getDay()+6)%7))/7);
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);

  // Pick 3 months starting from current month
  const monthsToShow = [];
  for (let i = 0; i < 3; i++) {
    const futureDate = new Date(today.getFullYear(), today.getMonth() + i);
    monthsToShow.push(monthNames[futureDate.getMonth()]);
  }

  let html = '';

  monthsToShow.forEach(monthName => {
    const monthDatesRaw = allDatesByMonth[monthName];
    if (!monthDatesRaw) return;

    // Sort all dates in the month (past & future)
    const monthDates = monthDatesRaw.sort((a,b) => parseMDY(a.date) - parseMDY(b.date));
    if (!monthDates.length) return;

    // Group by ISO week
    const weeksMap = {};
    monthDates.forEach(d => {
      const dObj = parseMDY(d.date);
      const weekNum = getISOWeekNumber(dObj);
      const tmpDate = new Date(dObj);
      tmpDate.setHours(0,0,0,0);
      tmpDate.setDate(tmpDate.getDate() + 3 - ((tmpDate.getDay() + 6) % 7));
      const weekKey = `${tmpDate.getFullYear()}-${String(weekNum).padStart(2,'0')}`;
      if (!weeksMap[weekKey]) weeksMap[weekKey] = {};
      weeksMap[weekKey][d.type] = d;
    });

    const sortedWeekKeys = Object.keys(weeksMap).sort((a,b) => {
      const [yA, wA] = a.split('-').map(Number);
      const [yB, wB] = b.split('-').map(Number);
      return yA !== yB ? yA - yB : wA - wB;
    });

    html += `<h3 style="margin-top:20px;">${monthName}</h3>`;
    html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; text-align:center;">`;
    html += `<thead><tr><th>Monday</th><th>Wednesday</th></tr></thead><tbody>`;

    sortedWeekKeys.forEach(weekKey => {
      const week = weeksMap[weekKey];
      html += `<tr>`;

      ['M','W'].forEach(type => {
        if (week[type]) {
          const date = week[type].date;
          const isPast = parseMDY(date) < minDate;
          const checked = signupMap[date] ? '✅' : '⬜️';
          const bgColor = isPast ? '#eee' : '#fff'; // past grey, future white
          const textColor = isPast ? '#333' : '#000';

          html += `<td style="font-size:1.1em; background-color:${bgColor}; color:${textColor}">${date} ${checked}</td>`;
        } else {
          html += `<td></td>`;
        }
      });

      html += `</tr>`;
    });

    html += `</tbody></table>`;
  });

  return html;
}









function getLimitedDayCountsFromClient(limitedDaysKeys) {
  try {
    const ss = SpreadsheetApp.openById(SIGNUP_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Sheet1");

    const lastCol = sheet.getLastColumn();
    const dateRow = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    const totalRow = sheet.getRange(2, 1, 1, lastCol).getDisplayValues()[0];

    const counts = {};
    limitedDaysKeys.forEach(day => {
      const colIndex = dateRow.findIndex(cell => cell === day);
      counts[day] = colIndex !== -1 ? totalRow[colIndex] : 0;
    });

    return counts;
  } catch (err) {
    return { error: err.message };
  }
}

function formatDateForSheet(dateStr) {
  let dateObj;
  if (typeof dateStr === "string") {
    const parts = dateStr.split('-');
    dateObj = parts.length === 3 ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) : new Date(dateStr);
  } else if (dateStr instanceof Date) {
    dateObj = dateStr;
  } else {
    throw new Error("Invalid date input to formatDateForSheet");
  }
  return formatDateToString(dateObj);
}


// Helper: normalize all date headers to MM/DD/YYYY
function normalizeSheetHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  const headerValues = headerRange.getDisplayValues()[0];

  const normalizedHeaders = headerValues.map(h => {
    const parts = h.split('/');
    // Only normalize if it looks like a date (2 or 4 digit year)
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return `${parts[0].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[2]}`;
    }
    return h; // leave non-date headers as-is
  });

  headerRange.setValues([normalizedHeaders]);
  logToBuffer("Sheet headers normalized to MM/DD/YYYY");
}


function savePlayerSignups(playerName, signupArray) {
  logToBuffer(`savePlayerSignups called for ${playerName}`);

  if (!playerName || !signupArray) {
    logToBuffer("No data to save");
    return "No data to save";
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // max 30 sec

    const ss = SpreadsheetApp.openById(SIGNUP_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Sheet1");

    // --- Normalize headers first ---
    const lastCol = sheet.getLastColumn();
    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    const headerValues = headerRange.getDisplayValues()[0];
    const headerMap = headerValues.map(h => {
      const parts = h.split('/');
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return `${parts[0].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[2]}`;
      }
      return h;
    });
    headerRange.setValues([headerMap]);
    logToBuffer("Sheet headers normalized to MM/DD/YYYY");

    const data = sheet.getDataRange().getDisplayValues(); // always use display
    const tz = Session.getScriptTimeZone();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find player row
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === playerName) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) {
      rowIndex = sheet.getLastRow() + 1;
      sheet.getRange(rowIndex, 1).setValue(playerName);
      logToBuffer(`Added new row for player: ${playerName} at row ${rowIndex}`);
    }

    const existingRow = data[rowIndex - 1] || [];
    const rowValues = Array(headerMap.length).fill('');
    rowValues[0] = playerName;

    // Preserve past dates
    for (let j = 1; j < headerMap.length; j++) {
      const parts = headerMap[j].split('/');
      if (parts.length === 3) {
        const colDate = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
        colDate.setHours(0, 0, 0, 0);
        if (colDate < today) {
          rowValues[j] = existingRow[j];
        }
      }
    }

    // Write new signups (future only)
    signupArray.forEach(({ date, signedUp }) => {
      const parts = date.split('/'); // MM/DD/YYYY
      if (parts.length !== 3) return;
      const parsedDate = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
      parsedDate.setHours(0, 0, 0, 0);
      if (parsedDate < today) return;

      const normalized = `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
      const colIndex = headerMap.indexOf(normalized);
      if (colIndex > 0) {
        rowValues[colIndex] = signedUp ? 'x' : '';
      } else {
        logToBuffer(`Date ${normalized} not found in header`);
      }
    });

    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    logToBuffer(`Saved signup data for player ${playerName}`);

  } catch (e) {
    logToBuffer(`Error during sheet update: ${e.message}`);
    throw e;
  } finally {
    lock.releaseLock();
  }

  // --- Send email outside lock ---
  try {
    const namesSheet = SpreadsheetApp.openById(NAMES_SPREADSHEET_ID).getSheetByName('Sheet1');
    const namesData = namesSheet.getRange('A2:B').getValues();
    const entry = namesData.find(row => row[0] === playerName);

    if (!entry || !entry[1]) {
      logToBuffer("Saved, but no email found for player");
      return "Saved, but no email found";
    }

    const email = entry[1];
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, yyyy h:mm a");
    const allDatesByMonth = getAvailableDates();

    const gridHtml = buildSignupEmailGrid(
      allDatesByMonth,
      signupArray.reduce((map, obj) => { map[obj.date] = obj.signedUp; return map; }, {}),
      playerName
    );

    const html = `
      <p style="font-weight:bold;text-align:center;font-size:1.1em;">Springfield Seniors Signup</p>
      <p>Hello ${playerName},</p>
      <p>Your latest Springfield Seniors Signup details are below —</p>
      <p>This web app–based signup system now replaces the usual emails to Ken Dunnett — so please do not contact him for signups.</p>
      <p><strong>
        For Monday play, signup must be in by the Saturday before by 2pm!<br>
        For Wednesday play, signup must be in by the Monday before by 2pm!
      </strong></p>
      <p> 1. Select your name. <br>
          2. To "SIGNUP" for a day to play, check the box for that day(s). <br>
          3. To "SIGNOUT – Cancel a SIGNUP", uncheck the box for that day(s) to cancel.<br>
          4. To save your selections and have them emailed to you, click the Save & Email button at the bottom. 
       </p>

       <p><strong>For last-minute changes PAST THE DEADLINES ONLY </strong>(sickness, etc.), please email ASAP. </p>

       <p>Ken, kendunnett@comporium.net , and <br>
          Alan, welch_misc@yahoo.com </p>

       <p> For technical problems or questions, email Alan. </p>

       <p> You can also access the signup system directly here: <br>
           https://alanrwelch.github.io/Springfield-Senior-Signups/   
       </p>

      ${gridHtml}
      <p style="font-size:0.9em;color:gray;">Sent: ${timestamp}</p>
      <p>Thanks and good luck!</p>
    `;

    GmailApp.sendEmail(email, `${playerName} - Your Springfield Seniors Signups`, "Thank you for signing up!", {
      htmlBody: html,
      cc: "welch_misc@yahoo.com",
      name: "Golf Scorecard"
    });

    logToBuffer(`Email sent to ${email}`);
    return "Saved and email sent";

  } catch (emailErr) {
    logToBuffer(`Email sending failed: ${emailErr.message}`);
    return "Saved but failed to send email";
  }
}

function getAvailableDates() {
  logToBuffer("getAvailableDates called");
  const sheet = SpreadsheetApp.openById(SIGNUP_SPREADSHEET_ID).getSheetByName("Sheet1");
  if (!sheet) throw new Error("Sheet 'Sheet1' not found");

  const headerRow = sheet.getRange(1, 2, 1, sheet.getLastColumn() - 1).getDisplayValues()[0];

  const allDatesByMonth = {};

  for (let i = 0; i < headerRow.length; i++) {
    const dateCell = headerRow[i];
    if (!dateCell) continue;

    const parts = dateCell.split('/');
    if (parts.length !== 3) continue;

    const rawDate = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
    rawDate.setHours(0, 0, 0, 0);

    const day = rawDate.getDay();
    const type = day === 1 ? 'M' : day === 3 ? 'W' : null; // Only Mondays and Wednesdays
    if (!type) continue;

    const monthLabel = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "MMMM");
    const mdyDate = formatDateToString(rawDate); // returns "MM/DD/YYYY"

    if (!allDatesByMonth[monthLabel]) allDatesByMonth[monthLabel] = [];
    allDatesByMonth[monthLabel].push({ date: mdyDate, type });
  }

  logToBuffer(`Found available dates in ${Object.keys(allDatesByMonth).length} months`);
  return allDatesByMonth;
}

function getAllDates() {
  logToBuffer("getAllDates called");
  return getAvailableDates();
}


// number of people signed up for the limited days
function getServerCounts() {
  const ss = SpreadsheetApp.openById(SIGNUP_SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Sheet1");
  const headerRow = 1; // Dates in row 1
  const valueRow = 2;  // Values in row 2

  const lastCol = sheet.getLastColumn();
  const dateValues = sheet.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0];  // use display values
  const serverCountsRow = sheet.getRange(valueRow, 1, 1, lastCol).getDisplayValues()[0]; // use display values

  const serverCounts = {};
  dateValues.forEach((dateStr, idx) => {
    if (dateStr) {
      const key = Utilities.formatDate(new Date(dateStr), Session.getScriptTimeZone(), "MM/dd/yyyy");
      const count = parseInt(serverCountsRow[idx], 10) || 0;
      serverCounts[key] = count;
      console.log(`• Date: ${key}, Server Count: ${count}`);
    }
  });

    return serverCounts;
}

