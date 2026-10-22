/**
 * ==========================================================================
 *  KOVAI LAKSHMI GRINDERS - BILLING, SALES & INVENTORY SYSTEM
 *  Backend: Google Apps Script  (acts as the API + database layer)
 *  Database: Google Sheets (the spreadsheet this script is attached to)
 *  Payments: Cash / Bank only - recorded manually, no online payment gateway
 * ==========================================================================
 *  HOW THIS FILE WORKS
 *  - doGet(e)  -> read-only requests from the website   (?action=...)
 *  - doPost(e) -> every other request from the website  (JSON body)
 *  - The "KLG Billing" menu inside the Google Sheet does the one-time jobs:
 *      1. Set up database (first time only)
 *      2. Set / change Super Admin login
 *      3. Turn on speed-up & monthly backup
 *    Full click-by-click steps: SETUP_GUIDE.md
 *
 *  SECURITY - nothing secret is written in this file.
 *  - There is NO default username or password anywhere in the code.
 *  - The Super Admin login is created from the Google Sheet menu and kept
 *    in this script's private Script Properties - never in the sheet.
 *  - Every password (Super Admin and billers) is stored only as a salted,
 *    repeatedly-hashed fingerprint. Nobody - not even someone who opens
 *    the spreadsheet - can read a password back out of it.
 *  - The website never stores a password. After login the browser holds
 *    only a temporary session ticket that expires on its own and is
 *    cancelled on logout.
 *  - Every permission is checked here, on the server, for every request.
 *  - 5 wrong passwords in a row lock that login for 15 minutes.
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// 0. BRANCH CONFIG - THE ONLY LINES THAT CHANGE BETWEEN BRANCHES.
//    For another branch: copy this whole project, change CODE and NAME
//    below, and deploy it on that branch's own spreadsheet. Everything else
//    (shop name, address, phone, logos, bank...) is typed into
//    Admin Settings on the website - not here.
// ---------------------------------------------------------------------------
const BRANCH = {
  CODE: 'CBE',          // short code inside every number: KLG-CBE-000001
  NAME: 'Coimbatore'    // used for the default shop name / app title only
};

const BRAND_CODE = 'KLG';
// Where the lightweight logos & icons live (the BILLING folder uploaded to
// the kovailakshmi.in website repo). Only used as DEFAULTS - each logo can
// be changed any time in Admin Settings -> Shop Details.
const ASSET_BASE = 'https://kovailakshmi.in/cbe-billing/BILLING/';
// Older address used before the app moved to kovailakshmi.in/cbe-billing/.
// Any logo saved with it in the Settings sheet is pointed to ASSET_BASE automatically.
const OLD_ASSET_BASES_ = ['https://kovailakshmi.in/BILLING/'];

// "KLG-CBE"
function idPrefix_() { return BRAND_CODE + '-' + BRANCH.CODE; }

const SHEET = {
  SETTINGS: 'Settings',
  BILLERS: 'Billers',
  CUSTOMERS: 'Customers',
  PRODUCTS: 'Products',
  BILLS: 'Bills',
  BILL_ITEMS: 'BillItems',
  DASHBOARD: 'Dashboard',
  STOCK_LOG: 'StockLog',
  UNIVERSAL_REPORT: 'UniversalReport',
  DAILY_REPORT: 'DailyReport',
  CUSTOM_CHARTS: 'CustomCharts'
};

// Bump this string every time you paste updated code into the Apps Script
// editor. The website compares it with its own expected value and shows a
// warning bar if they don't match - the surest way to prove a NEW
// DEPLOYMENT actually picked up your latest code (saving the file alone does
// NOT update the live /exec URL - Deploy > Manage deployments > pencil >
// Version: New version > Deploy).
const BACKEND_BUILD = 'KLG-2026-10-22-01';

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// 0a. SHEET LAYOUTS - one place for every tab's header row.
//     Column POSITIONS are used throughout this file, so new columns are
//     only ever added at the END of a row.
// ---------------------------------------------------------------------------
const BILLERS_HEADERS = [
  'BillerID', 'Name', 'PasswordHash', 'Active', 'CreatedAt',
  'CanAccessTax', 'CanAccessBank', 'CanAccessFindEdit',
  'CanAccessStockView', 'CanAccessStockEdit', 'CanAccessReportDownload',
  'CanAccessDiscount', 'CanAccessDashboard', 'CanAccessLetterpad'
];
const CUSTOMERS_HEADERS = ['CustomerID', 'Customer Name', 'Phone', 'Email', 'Address', 'DeliveryAddress', 'CreatedAt', 'CompanyName', 'CustomerGSTIN'];
const PRODUCTS_HEADERS = ['ProductID', 'ProductName', 'DefaultPrice', 'Active', 'CreatedAt', 'Stock', 'LowStockThreshold', 'HSN'];
const BILLS_HEADERS = [
  'BillID', 'Date', 'CustomerID', 'CustomerName', 'Phone', 'Email', 'Address', 'DeliveryAddress',
  'PaymentMethod', 'TotalQty', 'TotalAmount', 'PaymentStatus', 'BillerID', 'BillerName',
  'Spare1', 'Spare2', 'CreatedAt', 'UpdatedAt', 'UpdatedBy', 'VersionNote',
  'ShowTaxOverride', 'ShowBankOverride', 'DiscountPercent', 'CompanyName', 'CustomerGSTIN'
];
const BILL_ITEMS_HEADERS = ['BillID', 'ProductName', 'UnitPrice', 'Qty', 'LineTotal', 'DiscountPercent', 'HSN'];
const CUSTOM_CHARTS_HEADERS = ['ChartID', 'Name', 'Type', 'DataSource', 'Dimension', 'Metric', 'MetricField', 'TopN', 'SortDir', 'SortOrder', 'CreatedAt', 'Color'];
// PerformerRole/Name/Id are the clean, structured fields; PerformedBy is a
// human-readable combined label for anyone glancing at the raw sheet.
const STOCK_LOG_HEADERS = [
  'Timestamp', 'ProductID', 'ProductName', 'ChangeType', 'Delta', 'NewStock', 'BillID',
  'PerformedBy', 'PerformerRole', 'PerformerName', 'PerformerId'
];
const SHEET_HEADER_BG = '#EB343A';

// ---------------------------------------------------------------------------
// 0b. THEME DEFAULTS - Kovai Lakshmi Grinders brand (#eb343a -> #f48f33).
//     Super Admin can change every one of these live from Admin Settings ->
//     Theme; "Reset to Default Theme" brings back exactly this list.
// ---------------------------------------------------------------------------
const THEME_SETTING_DEFAULTS = [
  ['ThemeButtonStyle', 'gradient-diagonal'],
  ['ThemeButtonFrom', '#EB343A'],
  ['ThemeButtonTo', '#F48F33'],
  ['ThemeButtonText', '#FFFFFF'],
  ['ThemeSidebarStyle', 'gradient-vertical'],
  ['ThemeSidebarFrom', '#EB343A'],
  ['ThemeSidebarTo', '#F48F33'],
  ['ThemeSidebarText', '#FFFFFF'],
  ['ThemeNavActiveBg', '#FFFFFF'],
  ['ThemeNavActiveText', '#D42A30'],
  ['ThemeBillHeaderColor', '#D42A30'],
  ['ThemeHeadingColor', '#1F1B1B'],
  ['ThemeMutedColor', '#5A5150'],
  ['ThemeBgColor', '#F7F3F1'],
  ['ThemeSurfaceColor', '#FFFFFF'],
  ['ThemeBorderColor', '#EBDFDB'],
  ['ThemeChartPalette', '#EB343A,#F48F33,#B8232A,#F7B267,#8C2F39,#5A5150,#2E86AB,#6C4FB6,#1F9E78,#D4A017,#7A5C61,#3D5A80'],

  ['ThemeLoginBgStyle', 'gradient-diagonal'],
  ['ThemeLoginBgFrom', '#EB343A'],
  ['ThemeLoginBgTo', '#F48F33'],
  ['ThemeLoginCardBg', '#FFFFFF'],
  ['ThemeLoginHeadingColor', '#1F1B1B'],
  ['ThemeLoginTextColor', '#5A5150'],

  ['ThemePageHeadingColor', '#1F1B1B'],
  ['ThemePageSubheadingColor', '#5A5150'],
  ['ThemeSectionHeadingColor', '#1F1B1B'],

  ['ThemeTabActiveTextColor', '#D42A30'],
  ['ThemeTabInactiveTextColor', '#5A5150'],
  ['ThemeTabIndicatorStyle', 'gradient-diagonal'],
  ['ThemeTabIndicatorFrom', '#EB343A'],
  ['ThemeTabIndicatorTo', '#F48F33'],

  ['ThemeGateBgColor', '#FFF4EA'],
  ['ThemeGateBorderColor', '#F7B98A'],
  ['ThemeGateTitleColor', '#C2541A'],

  ['ThemeBillCompanyNameBold', 'TRUE'],
  ['ThemeBillCompanyNameItalic', 'FALSE'],
  ['ThemeBillCompanyNameUnderline', 'FALSE'],
  ['ThemeBillCompanyInfoBold', 'FALSE'],
  ['ThemeBillCompanyInfoItalic', 'FALSE'],
  ['ThemeBillCompanyInfoUnderline', 'FALSE'],
  ['ThemeBillHeaderLayout', 'logo-side'],

  // One shared design for every bill: on-screen preview, Print,
  // Save-as-PDF and the emailed PDF.
  ['ThemeBillFontFamily', "Georgia, 'Times New Roman', Times, serif"],
  ['ThemeBillDiscountColor', '#B23A2E'],
  ['ThemeBillLogoWidth', '130'],
  ['ThemeBillLogoHeight', '56'],

  ['ThemeButtonHoverFrom', '#D42A30'],
  ['ThemeButtonHoverTo', '#E57D1F'],
  ['ThemeOutlineText', '#D42A30'],
  ['ThemeOutlineBorder', '#EB343A'],
  ['ThemeOutlineHoverBg', '#FDEBEC'],
  ['ThemeOutlineHoverText', '#B8232A']
];

// ---------------------------------------------------------------------------
// 0c. SHOP DEFAULTS - written once by "Set up database". All editable later
//     in Admin Settings, so nothing here is ever "stuck".
// ---------------------------------------------------------------------------
function defaultShopSettings_() {
  return [
    ['CompanyName', 'Kovai Lakshmi Grinders - ' + BRANCH.NAME],
    ['AppTitle', 'KLG Billing - ' + BRANCH.NAME],
    ['Address', 'Bharathiyar Rd, P N Palayam, Coimbatore - 641037'],
    ['Phone', '9789731317'],
    ['Website', 'kovailakshmi.in'],
    ['GSTNumber', ''],
    ['LogoURL', ASSET_BASE + 'FAVICON.png'],
    ['PrintLogoURL', ASSET_BASE + 'BILL-LOGO.png'],
    ['LetterheadLogoURL', ASSET_BASE + 'FULL-LOGO.png'],
    ['CompanyEmail', 'info.kovailakshmi@gmail.com'],
    ['CGSTPercent', 0],
    ['SGSTPercent', 0],
    ['BankName', ''],
    ['BankAccountNo', ''],
    ['BankIFSC', ''],
    ['BankAccountHolder', ''],
    ['AuthorizedSignatoryLabel', 'Authorized Signatory'],
    ['ShowCompanyEmail', 'TRUE'],
    ['ShowTaxOnBill', 'TRUE'],
    ['ShowBankDetails', 'TRUE'],
    ['ShowDiscountOption', 'TRUE'],
    ['ShowAuthorizedSignatory', 'TRUE'],
    ['ShowHSNOnBill', 'FALSE'],
    ['ShowAmountInWords', 'TRUE'],
    ['ShowTerms', 'FALSE'],
    ['TermsText', 'Goods once sold will not be taken back or exchanged.\nWarranty as per the manufacturer\'s terms; physical damage is not covered.\nSubject to Coimbatore jurisdiction.'],
    ['SocialWhatsApp', '7094464175'],
    ['SocialInstagram', 'https://www.instagram.com/lakshmi.grinders/'],
    ['SocialFacebook', 'https://www.facebook.com/p/kovai-Lakshmi-Grinders-100088313569360/'],
    ['SocialLinkedIn', 'https://www.linkedin.com/company/kovai-lakshmi-grinders-cbe'],
    ['SocialYouTube', 'https://www.youtube.com/@kovailakshmigrinders'],
    ['Currency', 'INR']
  ];
}
// Keys added after a shop's database was first set up get their default
// filled in automatically (never overwriting anything already saved).
const LATE_SETTING_KEYS_ = ['AppTitle', 'LetterheadLogoURL', 'ShowHSNOnBill', 'ShowAmountInWords', 'ShowTerms', 'TermsText'];

// ---------------------------------------------------------------------------
// 0d. SCHEMA CHECK - cheap no-op once caught up. Never destructive: it only
//     adds missing tabs and missing Settings keys.
// ---------------------------------------------------------------------------
function migrateSchema_() {
  const props = PropertiesService.getScriptProperties();
  const current = Number(props.getProperty('SchemaVersion') || '0');
  if (current >= SCHEMA_VERSION) return;
  const ssRef = ss_();
  // Not set up yet - "Set up database" does the full job; nothing to patch.
  if (!ssRef.getSheetByName(SHEET.SETTINGS)) return;
  provisionSchemaOnSpreadsheet_(ssRef);
  const settingsSh = ssRef.getSheetByName(SHEET.SETTINGS);
  const keys = settingsSh.getLastRow() > 0 ? settingsSh.getRange(1, 1, settingsSh.getLastRow(), 1).getValues().map(r => r[0]) : [];
  const defaults = defaultShopSettings_();
  const toAdd = [];
  defaults.forEach(pair => { if (LATE_SETTING_KEYS_.indexOf(pair[0]) !== -1 && keys.indexOf(pair[0]) === -1) toAdd.push(pair); });
  THEME_SETTING_DEFAULTS.forEach(pair => { if (keys.indexOf(pair[0]) === -1) toAdd.push(pair); });
  if (toAdd.length) settingsSh.getRange(settingsSh.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd.map(r => [r[0], cellSafe_(r[1])]));
  props.setProperty('SchemaVersion', String(SCHEMA_VERSION));
  invalidateCache_('settings');
}

// ---------------------------------------------------------------------------
// 1. ENTRY POINTS
// ---------------------------------------------------------------------------
// The session of the request currently being handled ({ role, billerId,
// billerName, pwTag }). Set once per request in doGet/doPost.
let SESSION_ = null;

// Actions anyone may call without logging in. They return nothing private:
// 'getSettings' only gives the login screen its colours, logo and name.
const PUBLIC_ACTIONS_ = { getSettings: true, ping: true, login: true };

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'ping') return jsonOut({ ok: true, serverBuild: BACKEND_BUILD });
    migrateSchema_();
    if (!PUBLIC_ACTIONS_[action]) {
      const authCheck = requireSession_(e.parameter.token);
      if (!authCheck.ok) return jsonOut(authCheck);
    }

    let result;
    switch (action) {
      case 'bootstrap':      result = apiBootstrap(); break;
      case 'findCustomer':   result = apiFindCustomer(e.parameter.phone, e.parameter.name, { withVisits: true }); break;
      case 'getBillsByPhone': result = needPerm_('canAccessFindEdit') || apiGetBillsByPhone(e.parameter.phone); break;
      case 'getCustomers':   result = apiGetCustomersList(); break;
      case 'getBill':        result = apiGetBill(e.parameter.billId); break;
      case 'getDashboardData': result = needPerm_('canAccessDashboard') || apiGetDashboardData(e.parameter); break;
      case 'getBillers':     result = apiGetBillers(); break;
      case 'getProducts':    result = apiGetProducts(true); break;
      case 'getSettings':    result = apiGetSettingsPublic(); break;
      case 'getStockLog':    result = needPerm_('stock') || apiGetStockLog(e.parameter); break;
      case 'getCapacityStatus': result = apiGetCapacityStatus(); break;
      case 'getUniversalReport':    result = apiGetUniversalReport(); break;
      case 'getDailyReport':        result = apiGetDailyReport(); break;
      case 'getInventoryLogReport': result = apiGetInventoryLogReport(); break;
      case 'getCustomCharts': result = needPerm_('canAccessDashboard') || apiGetCustomCharts(); break;
      case 'getCustomChartData': result = needPerm_('canAccessDashboard') || apiGetCustomChartData(e.parameter); break;
      case 'getEmailPreview': result = apiGetEmailPreview(e.parameter); break;
      default:
        result = { ok: false, error: 'Unknown GET action: ' + action };
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const p = body.payload || {};
    if (action === 'ping') return jsonOut({ ok: true, serverBuild: BACKEND_BUILD });
    migrateSchema_();

    if (!PUBLIC_ACTIONS_[action]) {
      const authCheck = requireSession_(body.token);
      if (!authCheck.ok) return jsonOut(authCheck);
    }

    let result;
    switch (action) {
      case 'login':          result = apiLogin(p); break;
      case 'logout':         result = apiLogout(body.token); break;
      case 'saveBill':       result = apiSaveBill(p); break;
      case 'refreshDashboardSheet': result = apiRefreshDashboardSheet(p); break;
      case 'updateBill':     result = apiUpdateBill(p); break;
      case 'saveCustomer':   result = apiSaveCustomer(p); break;
      case 'addProduct':     result = apiAddProduct(p); break;
      case 'updateProduct':  result = apiUpdateProduct(p); break;
      case 'deleteProduct':  result = apiDeleteProduct(p); break;
      case 'saveBiller':     result = apiSaveBiller(p); break;
      case 'toggleBiller':   result = apiToggleBiller(p); break;
      case 'setBillerAccess': result = apiSetBillerAccess(p); break;
      case 'deleteBiller':   result = apiDeleteBiller(p); break;
      case 'setProductStock': result = apiSetProductStock(p); break;
      case 'updateSettings': result = apiUpdateSettings(p); break;
      case 'emailBillPdf':   result = apiEmailBillPdf(p); break;
      case 'autoExpandDatabase': result = apiAutoExpandDatabase(p); break;
      case 'getDataDiagnostics': result = apiGetDataDiagnostics(p); break;
      case 'resetToActiveOnly': result = apiResetToActiveOnly(p); break;
      case 'refreshNumbering': result = apiRefreshNumbering(p); break;
      case 'updateTheme': result = apiUpdateTheme(p); break;
      case 'resetTheme': result = apiResetTheme(p); break;
      case 'getCustomCharts': result = needPerm_('canAccessDashboard') || apiGetCustomCharts(); break;
      case 'saveCustomChart': result = apiSaveCustomChart(p); break;
      case 'deleteCustomChart': result = apiDeleteCustomChart(p); break;
      case 'reorderCustomCharts': result = apiReorderCustomCharts(p); break;
      case 'getCustomChartData': result = needPerm_('canAccessDashboard') || apiGetCustomChartData(p); break;
      default:
        result = { ok: false, error: 'Unknown POST action: ' + action };
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// 1b. PASSWORDS - salted, repeatedly-hashed fingerprints. The real password
//     is never stored anywhere. Format: v1$<rounds>$<salt>$<hash>
// ---------------------------------------------------------------------------
const PW_ROUNDS_ = 300;

function hashPassword_(password, saltB64, rounds) {
  const salt = saltB64 || Utilities.base64EncodeWebSafe(Utilities.newBlob(Utilities.getUuid() + Utilities.getUuid()).getBytes()).slice(0, 32);
  const n = rounds || PW_ROUNDS_;
  const pwBytes = Utilities.newBlob(String(password)).getBytes();
  let h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt).getBytes(), pwBytes);
  for (let i = 1; i < n; i++) h = Utilities.computeHmacSha256Signature(h, pwBytes);
  return 'v1$' + n + '$' + salt + '$' + Utilities.base64EncodeWebSafe(h);
}

function verifyPassword_(password, stored) {
  const s = String(stored == null ? '' : stored);
  const parts = s.split('$');
  if (parts.length !== 4 || parts[0] !== 'v1' || !password) return false;
  const candidate = hashPassword_(password, parts[2], Number(parts[1]) || PW_ROUNDS_);
  // Compare every character, so the time taken never hints at how close a guess was.
  if (candidate.length !== s.length) return false;
  let diff = 0;
  for (let i = 0; i < s.length; i++) diff |= candidate.charCodeAt(i) ^ s.charCodeAt(i);
  return diff === 0;
}

// A short tag of the stored hash, kept inside each session. Changing a
// password changes the hash, so every session made with the OLD password
// stops working straight away.
function pwTag_(stored) { return String(stored || '').slice(-16); }

// The Super Admin login lives in Script Properties (private to this script),
// never in the spreadsheet.
function superAdminConfig_() {
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('SUPER_ADMIN_USER');
  const hash = props.getProperty('SUPER_ADMIN_HASH');
  return (user && hash) ? { user: user, hash: hash } : null;
}
function setSuperAdmin_(user, password) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SUPER_ADMIN_USER', user);
  props.setProperty('SUPER_ADMIN_HASH', hashPassword_(password));
}
const NOT_SET_UP_MSG_ = 'The Super Admin login has not been set up yet. Open the Google Sheet, click the "KLG Billing" menu and choose "Set / change Super Admin login".';

// ---------------------------------------------------------------------------
// 1c. LOGIN LOCKOUT - 5 wrong passwords in a row lock that login for 15
//     minutes. Counters live in CacheService and clear on a correct login.
// ---------------------------------------------------------------------------
const LOGIN_MAX_FAILS_ = 5;
const LOGIN_LOCK_SECONDS_ = 900;
function lockKey_(name) {
  return 'lf_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(name || '').trim().toLowerCase()));
}
function isLockedOut_(name) {
  return Number(CacheService.getScriptCache().get(lockKey_(name)) || 0) >= LOGIN_MAX_FAILS_;
}
function noteFailedLogin_(name) {
  const c = CacheService.getScriptCache();
  const k = lockKey_(name);
  c.put(k, String(Number(c.get(k) || 0) + 1), LOGIN_LOCK_SECONDS_);
}
function clearFailedLogins_(name) { CacheService.getScriptCache().remove(lockKey_(name)); }
const LOCKED_MSG_ = 'Too many wrong passwords. This login is locked for 15 minutes - please try again later.';

// ---------------------------------------------------------------------------
// 1d. SESSIONS - a random ticket minted only by a successful login, kept
//     server-side in CacheService for at most 6 hours (Apps Script's
//     ceiling). The browser holds only the ticket - never a password.
// ---------------------------------------------------------------------------
const SESSION_TTL_SECONDS = 21600;

function createSession_(sessionData) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(sessionData), SESSION_TTL_SECONDS);
  return token;
}

function requireSession_(token) {
  if (!token || !/^[A-Za-z0-9\-]{20,100}$/.test(String(token))) {
    return { ok: false, error: 'Not logged in. Please log in again.', sessionExpired: true };
  }
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return { ok: false, error: 'Your session has expired. Please log in again.', sessionExpired: true };
  const sess = JSON.parse(raw);
  // Still valid? A changed password, a deactivated or deleted biller, or a
  // changed Super Admin login ends the session immediately.
  if (sess.role === 'admin') {
    const cfg = superAdminConfig_();
    if (!cfg || cfg.user !== sess.user || pwTag_(cfg.hash) !== sess.pwTag) {
      CacheService.getScriptCache().remove('sess_' + token);
      return { ok: false, error: 'Your login was changed. Please log in again.', sessionExpired: true };
    }
  } else {
    const b = findBillerRow_(sess.billerId);
    if (!b || !b.active || pwTag_(b.hash) !== sess.pwTag) {
      CacheService.getScriptCache().remove('sess_' + token);
      return { ok: false, error: 'Your login is no longer active. Please log in again.', sessionExpired: true };
    }
  }
  SESSION_ = sess;
  return { ok: true, session: sess };
}

function apiLogout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return { ok: true };
}

function isAdminSession_() { return !!(SESSION_ && SESSION_.role === 'admin'); }

// The current user's permissions, read LIVE from the Billers sheet (cached
// briefly) - never from anything the browser says. Super Admin has all.
function currentPerms_() {
  const all = {
    canAccessTax: true, canAccessBank: true, canAccessFindEdit: true, canAccessStockView: true,
    canAccessStockEdit: true, canAccessReportDownload: true, canAccessDiscount: true,
    canAccessDashboard: true, canAccessLetterpad: true
  };
  if (isAdminSession_()) return all;
  const b = SESSION_ ? findBillerRow_(SESSION_.billerId) : null;
  if (!b) return {};
  return b.perms;
}

// Returns an error object when the current user lacks `perm`, else null -
// so it reads naturally as `needPerm_('x') || doTheThing()`.
function needPerm_(perm) {
  const perms = currentPerms_();
  const ok = perm === 'stock' ? (perms.canAccessStockView || perms.canAccessStockEdit) : !!perms[perm];
  return ok ? null : { ok: false, error: 'You do not have access to this. Ask the Super Admin to switch it on for you.' };
}

// ---------------------------------------------------------------------------
// 1e. INPUT RULES - the server-side source of truth for what every field is
//     allowed to hold. app.js applies the SAME rules while typing (see
//     INPUT_RULES there) for instant feedback - but a browser can always be
//     bypassed, so every write below is re-checked here first.
// ---------------------------------------------------------------------------
const VR = {
  // Letters in ANY language (incl. Tamil, which needs the \p{M} combining
  // marks), spaces, dot, apostrophe, hyphen. Must start with a letter.
  PERSON_NAME: /^[\p{L}\p{M}][\p{L}\p{M} .'\-]*$/u,
  // Product names: letters, digits and the symbols real product names use -
  // "Wet Grinder 2L (Tilting)", "Mixer 750W - 3 Jar", "SS 304 #12".
  PRODUCT_NAME: /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ()\-\/.,&+'%#:]*$/u,
  ADDRESS: /^[\p{L}\p{M}\p{N} \n,.\-\/#():'&]*$/u,
  ORG_NAME: /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,&'()\-]*$/u,
  EMAIL: /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/,
  GSTIN: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  HSN: /^\d{4,8}$/,
  IFSC: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  ACCOUNT_NO: /^\d{9,18}$/,
  HEX_COLOR: /^#[0-9A-Fa-f]{6}$/,
  WEBSITE: /^(https?:\/\/)?[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+(\/[^\s<>"']*)?$/,
  URL: /^https?:\/\/[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+(:\d+)?(\/[^\s<>"']*)?$/,
  ADMIN_USER: /^[\p{L}\p{N}][\p{L}\p{N} ._\-@]*$/u
};
const VLIMIT = {
  MONEY_MAX: 10000000, QTY_MAX: 9999, STOCK_MAX: 999999, THRESHOLD_MAX: 99999,
  ADDRESS_MAX: 250, NOTE_MAX: 200, TERMS_MAX: 1200
};
const PAYMENT_METHODS = ['Cash', 'Bank'];
const PAYMENT_STATUSES = ['Cash Collected', 'Pending', 'Paid', 'Failed'];

function vRes_(value, error) { return { value: value, error: error || '' }; }

// Removes control characters (keeps \n) - pasted text from WhatsApp/Word
// often carries invisible ones that later break matching and exports.
function vText_(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‍﻿]/g, '');
}
function vLine_(v) { return vText_(v).replace(/\s+/g, ' ').trim(); }
function vMulti_(v) {
  return vText_(v).split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Phone numbers are stored as bare digits. "+91 98765 43210",
// "919876543210" and "09876543210" all reduce to the same 10 digits.
function normalizeMobile_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
  else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
  return d;
}
function vMobile_(raw, label, required) {
  if (!String(raw == null ? '' : raw).trim()) return vRes_('', required ? label + ' is required.' : '');
  const d = normalizeMobile_(raw);
  if (!/^[6-9]\d{9}$/.test(d)) {
    return vRes_(d, label + ' must be a 10-digit mobile number starting with 6, 7, 8 or 9 (digits only - no spaces, letters or symbols).');
  }
  return vRes_(d);
}
// The shop's own phone may be a landline with an STD code (0422xxxxxxx).
function vShopPhone_(raw, label) {
  if (!String(raw == null ? '' : raw).trim()) return vRes_('');
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
  if (!/^(\d{10}|0\d{10})$/.test(d)) return vRes_(d, label + ' must be 10 digits (or 11 digits for a landline starting with 0) - digits only.');
  return vRes_(d);
}
function vPersonName_(raw, label, required) {
  const v = vLine_(raw);
  if (!v) return vRes_(v, required ? label + ' is required.' : '');
  if (v.length < 2 || v.length > 60) return vRes_(v, label + ' must be 2 to 60 characters.');
  if (!VR.PERSON_NAME.test(v)) return vRes_(v, label + ' can only contain letters, spaces, dot (.), apostrophe (\') and hyphen (-).');
  return vRes_(v);
}
function vEmail_(raw, label, required) {
  const v = vLine_(raw).replace(/\s/g, '');
  if (!v) return vRes_(v, required ? label + ' is required.' : '');
  if (v.length > 100 || v.indexOf('..') !== -1 || !VR.EMAIL.test(v)) return vRes_(v, label + ' is not a valid email address (e.g. name@example.com).');
  return vRes_(v);
}
function vAddress_(raw, label) {
  const v = vMulti_(raw);
  if (!v) return vRes_(v);
  if (v.length > VLIMIT.ADDRESS_MAX) return vRes_(v, label + ' must be at most ' + VLIMIT.ADDRESS_MAX + ' characters.');
  if (!VR.ADDRESS.test(v)) return vRes_(v, label + ' can only contain letters, numbers, spaces and  , . - / # ( ) : \' &');
  if (!/[\p{L}\p{N}]/u.test(v)) return vRes_(v, label + ' must contain letters or numbers.');
  return vRes_(v);
}
function vProductName_(raw, label) {
  const v = vLine_(raw);
  if (!v) return vRes_(v, label + ' is required.');
  if (v.length < 2 || v.length > 80) return vRes_(v, label + ' must be 2 to 80 characters.');
  if (!VR.PRODUCT_NAME.test(v)) return vRes_(v, label + ' must start with a letter or number and can only use letters, numbers, spaces and  ( ) - / . , & + \' % # :');
  return vRes_(v);
}
function vFreeText_(raw, label, maxLen, required, minLen) {
  const v = vLine_(raw).replace(/[<>]/g, '');
  if (!v) return vRes_(v, required ? label + ' is required.' : '');
  if (minLen && v.length < minLen) return vRes_(v, label + ' must be at least ' + minLen + ' characters.');
  if (v.length > maxLen) return vRes_(v, label + ' must be at most ' + maxLen + ' characters.');
  return vRes_(v);
}
function vMultiText_(raw, label, maxLen) {
  const v = vMulti_(raw).replace(/[<>]/g, '');
  if (v.length > maxLen) return vRes_(v, label + ' must be at most ' + maxLen + ' characters.');
  return vRes_(v);
}
function vPattern_(raw, label, re, maxLen, hint, transform) {
  let v = vLine_(raw);
  if (transform) v = transform(v);
  if (!v) return vRes_(v);
  if (v.length > maxLen || !re.test(v)) return vRes_(v, label + ' ' + hint);
  return vRes_(v);
}
function vGstin_(raw, label) {
  return vPattern_(raw, label, VR.GSTIN, 15, 'must be a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5).', function (x) { return x.toUpperCase().replace(/\s/g, ''); });
}
function vOrgName_(raw, label, maxLen) {
  return vPattern_(raw, label, VR.ORG_NAME, maxLen || 80, 'can only contain letters, numbers, spaces and . , & \' ( ) -');
}
function vHsn_(raw, label) {
  return vPattern_(raw, label, VR.HSN, 8, 'must be 4 to 8 digits (digits only).', function (x) { return x.replace(/\s/g, ''); });
}
// Accepts "instagram.com/x" and quietly adds https:// rather than rejecting.
function vUrl_(raw, label) {
  let v = vLine_(raw).replace(/\s/g, '');
  if (!v) return vRes_(v);
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  if (v.length > 300 || !VR.URL.test(v)) return vRes_(v, label + ' is not a valid link (e.g. https://example.com/page).');
  return vRes_(v);
}
function vNumber_(raw, label, opts) {
  opts = opts || {};
  const min = opts.min != null ? opts.min : 0;
  const max = opts.max != null ? opts.max : VLIMIT.MONEY_MAX;
  if (raw === '' || raw == null) {
    if (opts.required) return vRes_(null, label + ' is required.');
    return vRes_(opts.blank !== undefined ? opts.blank : 0);
  }
  const s = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s) && typeof raw !== 'number') return vRes_(null, label + ' must be a number.');
  const n = Number(raw);
  if (!isFinite(n)) return vRes_(null, label + ' must be a number.');
  if (opts.integer && Math.floor(n) !== n) return vRes_(null, label + ' must be a whole number.');
  if (n < min) return vRes_(null, label + ' cannot be less than ' + min + '.');
  if (n > max) return vRes_(null, label + ' cannot be more than ' + max + '.');
  return vRes_(opts.integer ? n : Math.round(n * 100) / 100);
}
function vMoney_(raw, label, required) { return vNumber_(raw, label, { min: 0, max: VLIMIT.MONEY_MAX, required: required }); }
function vPercent_(raw, label) { return vNumber_(raw, label, { min: 0, max: 100 }); }
function vInt_(raw, label, min, max, required, blank) {
  return vNumber_(raw, label, { min: min, max: max, integer: true, required: required, blank: blank });
}
function vPassword_(raw, label, minLen, required) {
  const v = String(raw == null ? '' : raw);
  if (!v) return vRes_(v, required ? label + ' is required.' : '');
  if (/\s/.test(v)) return vRes_(v, label + ' cannot contain spaces.');
  if (v.length < minLen || v.length > 30) return vRes_(v, label + ' must be ' + minLen + ' to 30 characters.');
  return vRes_(v);
}
// Bill date: a real calendar date, not before 2000, never in the future
// (one day of slack so a time-zone edge near midnight never blocks a bill).
function vDate_(raw, label) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return vRes_(v, label + ' is required.');
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return vRes_(v, label + ' must be a valid date.');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    return vRes_(v, label + ' must be a valid date.');
  }
  if (v < '2000-01-01') return vRes_(v, label + ' is too far in the past.');
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), 'Asia/Kolkata', 'yyyy-MM-dd');
  if (v > tomorrow) return vRes_(v, label + ' cannot be in the future.');
  return vRes_(v);
}
function vOneOf_(raw, label, allowed) {
  const v = String(raw == null ? '' : raw).trim();
  if (allowed.indexOf(v) === -1) return vRes_(v, label + ' is not a valid choice.');
  return vRes_(v);
}

// Validates a bill's line items. `knownNames` (lower-cased) are names that
// already exist - in the Products sheet, or on the bill being edited - and
// are accepted as-is, so an older product can always still be billed.
function vItems_(items, knownNames) {
  if (!Array.isArray(items) || !items.length) return { error: 'Add at least one product.' };
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const line = 'line ' + (i + 1);
    let name = vLine_(it.name);
    if (!name || !knownNames || !knownNames[name.toLowerCase()]) {
      const r = vProductName_(it.name, 'Product name on ' + line);
      if (r.error) return { error: r.error };
      name = r.value;
    }
    const price = vMoney_(it.price, 'Price on ' + line, true);
    if (price.error) return { error: price.error };
    const qty = vInt_(it.qty, 'Qty on ' + line, 1, VLIMIT.QTY_MAX, true);
    if (qty.error) return { error: qty.error };
    const disc = vPercent_(it.discountPercent != null ? it.discountPercent : 0, 'Discount % on ' + line);
    if (disc.error) return { error: disc.error };
    out.push({ name: name, price: price.value, qty: qty.value, discountPercent: disc.value });
  }
  return { items: out };
}

// Runs a list of [field, result] checks and returns the first error, or the
// cleaned values keyed by field.
function vCollect_(checks) {
  const values = {};
  for (let i = 0; i < checks.length; i++) {
    if (checks[i][1].error) return { ok: false, error: checks[i][1].error, field: checks[i][0] };
    values[checks[i][0]] = checks[i][1].value;
  }
  return { ok: true, values: values };
}

// Google Sheets treats any text starting with = + - @ as a FORMULA. A
// leading apostrophe forces plain text; Sheets hides it and never returns
// it when the cell is read, so the stored value is exactly what was typed.
function cellSafe_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

// Forces a value to be stored as TEXT. Without this, Sheets turns "0001"
// into the number 1.
function asText_(v) { return "'" + String(v); }

// For values READ from a sheet and written straight back: text stays text,
// numbers/booleans/dates stay exactly what they were.
function keepType_(v) { return (typeof v === 'string' && v !== '') ? "'" + v : v; }

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// ---------------------------------------------------------------------------
// 2. SPEED - a small cache layer (CacheService) for the data every screen
//    needs: settings, products, billers and the customer list. Every write
//    clears the matching entry at once; the keep-warm trigger (section 16)
//    rebuilds them every 10 minutes so the very first request after a quiet
//    spell is fast too. Big lists are split into 90 KB pieces because one
//    cache entry holds at most 100 KB.
// ---------------------------------------------------------------------------
const CACHE_TTL_ = 1800; // 30 min - the keep-warm trigger refreshes every 10
const MEMO_ = {};        // per-request memory, so one request reads each thing once

function cacheNs_() {
  if (MEMO_.ns) return MEMO_.ns;
  const props = PropertiesService.getScriptProperties();
  MEMO_.ns = 'g' + (props.getProperty('CACHE_GEN') || '1') + '_' + (props.getProperty('ACTIVE_SPREADSHEET_ID') || 'bound').slice(-10) + '_';
  return MEMO_.ns;
}
function cacheGetJson_(name) {
  const c = CacheService.getScriptCache();
  const base = cacheNs_() + name;
  const head = c.get(base + '_n');
  if (!head) return null;
  const n = Number(head);
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(base + '_' + i);
  const got = c.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) {
    if (got[keys[i]] == null) return null;
    s += got[keys[i]];
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}
function cachePutJson_(name, obj) {
  const s = JSON.stringify(obj);
  const CHUNK = 90000;
  const n = Math.max(1, Math.ceil(s.length / CHUNK));
  if (n > 50) return; // too big to be worth caching - just read the sheet
  const c = CacheService.getScriptCache();
  const base = cacheNs_() + name;
  const map = {};
  for (let i = 0; i < n; i++) map[base + '_' + i] = s.slice(i * CHUNK, (i + 1) * CHUNK);
  try { c.putAll(map, CACHE_TTL_); c.put(base + '_n', String(n), CACHE_TTL_); } catch (e) { /* cache full - fine */ }
}
// Reads `name` from cache, or builds it with `builder()` and caches it. The
// version check stops a slow rebuild from overwriting a newer write that
// happened while it was running.
function cached_(name, builder) {
  if (MEMO_['c_' + name] !== undefined) return MEMO_['c_' + name];
  let val = cacheGetJson_(name);
  if (val === null) {
    const c = CacheService.getScriptCache();
    const verKey = cacheNs_() + 'ver_' + name;
    const v0 = c.get(verKey);
    val = builder();
    if (c.get(verKey) === v0) cachePutJson_(name, val);
  }
  MEMO_['c_' + name] = val;
  return val;
}
function invalidateCache_() {
  const c = CacheService.getScriptCache();
  for (let i = 0; i < arguments.length; i++) {
    const name = arguments[i];
    delete MEMO_['c_' + name];
    c.put(cacheNs_() + 'ver_' + name, Utilities.getUuid(), 21600);
    c.remove(cacheNs_() + name + '_n');
  }
}
// Forgets EVERYTHING cached (used after a database switch, and from the
// sheet menu after someone edits the spreadsheet by hand).
function clearAllCache_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('CACHE_GEN', String(Number(props.getProperty('CACHE_GEN') || '1') + 1));
  delete MEMO_.ns;
  Object.keys(MEMO_).forEach(function (k) { delete MEMO_[k]; });
}

// ---------------------------------------------------------------------------
// 3. SETTINGS HELPERS
// ---------------------------------------------------------------------------
function getSettingsMap_() {
  return fixAssetUrls_(cached_('settings', function () {
    const sh = ss_().getSheetByName(SHEET.SETTINGS);
    if (!sh) return {};
    const data = sh.getDataRange().getValues();
    const map = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) map[data[i][0]] = data[i][1];
    }
    return map;
  }));
}

// Points logo addresses saved under the old image folder to the current one.
function fixAssetUrls_(map) {
  ['LogoURL', 'PrintLogoURL', 'LetterheadLogoURL'].forEach(function (k) {
    const v = String(map[k] || '');
    OLD_ASSET_BASES_.forEach(function (oldBase) {
      if (v.indexOf(oldBase) === 0) map[k] = ASSET_BASE + v.slice(oldBase.length);
    });
  });
  return map;
}

// Writes many settings with one read + one write. Existing rows are updated
// in place, missing keys are appended at the bottom.
function setSettings_(map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return;
  const sh = ss_().getSheetByName(SHEET.SETTINGS);
  const lastRow = sh.getLastRow();
  const colA = lastRow > 0 ? sh.getRange(1, 1, lastRow, 1).getValues() : [];
  const colB = lastRow > 0 ? sh.getRange(1, 2, lastRow, 1).getValues() : [];
  const rowOf = {};
  for (let i = 1; i < colA.length; i++) {
    if (colA[i][0] !== '' && rowOf[colA[i][0]] === undefined) rowOf[colA[i][0]] = i;
  }
  const toAppend = [];
  let changed = false;
  keys.forEach(function (k) {
    const v = cellSafe_(map[k]);
    if (rowOf[k] !== undefined) { colB[rowOf[k]][0] = v; changed = true; }
    else toAppend.push([k, v]);
  });
  if (changed) sh.getRange(1, 2, colB.length, 1).setValues(colB);
  if (toAppend.length) sh.getRange(lastRow + 1, 1, toAppend.length, 2).setValues(toAppend);
  invalidateCache_('settings');
}

// Memoised for the life of ONE request - SpreadsheetApp.openById() is slow.
let SS_CACHE_ = null;
function resetSsCache_() { SS_CACHE_ = null; }

function ss_() {
  if (SS_CACHE_) return SS_CACHE_;
  // After "Add New Database", ACTIVE_SPREADSHEET_ID points every read/write
  // at the new spreadsheet. Until then it's unset and the spreadsheet this
  // script is attached to is used.
  const activeId = PropertiesService.getScriptProperties().getProperty('ACTIVE_SPREADSHEET_ID');
  if (activeId) {
    try {
      SS_CACHE_ = SpreadsheetApp.openById(activeId);
      return SS_CACHE_;
    } catch (e) {
      throw new Error('ACTIVE_SPREADSHEET_ID is set to "' + activeId + '" but that spreadsheet could not be opened (' + e + '). Check the ID is correct and this script\'s account still has access to it.');
    }
  }
  SS_CACHE_ = SpreadsheetApp.getActiveSpreadsheet();
  if (!SS_CACHE_) throw new Error('This script is not attached to a Google Sheet. Open your spreadsheet, then Extensions > Apps Script, and paste the code there.');
  return SS_CACHE_;
}

// ---------------------------------------------------------------------------
// 4. MULTI-SPREADSHEET CONTINUITY - the "Active + Archive" model.
//    When a spreadsheet nears Google's cell ceiling, "Add New Database"
//    (Admin Settings) freezes the current one as a read-only archive and
//    points every future write at a brand-new spreadsheet. Reports and Find
//    Bill transparently read across both. Master data (Settings, Billers,
//    Products, Customers) is copied forward so nothing "resets".
// ---------------------------------------------------------------------------
function getArchiveRegistry_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ARCHIVE_SPREADSHEET_IDS');
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch (e) { return []; }
}

// An archive that's been deleted or unshared is skipped (logged, not thrown).
function openArchives_() {
  if (MEMO_.archives) return MEMO_.archives;
  MEMO_.archives = getArchiveRegistry_().map(entry => {
    try {
      return { ss: SpreadsheetApp.openById(entry.id), label: entry.label || entry.id };
    } catch (e) {
      Logger.log('Archive spreadsheet unreachable, skipped: ' + entry.id + ' - ' + e);
      return null;
    }
  }).filter(Boolean);
  return MEMO_.archives;
}

// Every database this app can currently read from - the active one first.
function allDbs_() {
  return [{ ss: ss_(), label: 'Active' }].concat(openArchives_());
}

function createFreshDatabaseSpreadsheet_(name) {
  const newSs = SpreadsheetApp.create(name);
  provisionSchemaOnSpreadsheet_(newSs);
  const defaultSheet = newSs.getSheetByName('Sheet1');
  if (defaultSheet && newSs.getSheets().length > 1) newSs.deleteSheet(defaultSheet);
  return newSs;
}

// Copies MASTER data forward - Settings, Billers, Products, Customers.
// Bills/BillItems/StockLog stay behind on the archived spreadsheet.
function copyMasterDataForward_(fromSs, toSs) {
  [SHEET.SETTINGS, SHEET.BILLERS, SHEET.PRODUCTS, SHEET.CUSTOMERS].forEach(function (name) {
    const fromSh = fromSs.getSheetByName(name);
    const toSh = toSs.getSheetByName(name);
    if (!fromSh || !toSh) return;
    const data = fromSh.getDataRange().getValues();
    if (data.length <= 1) return;
    const rows = data.slice(1).map(function (row) { return row.map(keepType_); });
    const numCols = data[0].length;
    if (toSh.getLastRow() > 1) toSh.getRange(2, 1, toSh.getLastRow() - 1, toSh.getLastColumn()).clearContent();
    toSh.getRange(2, 1, rows.length, numCols).setValues(rows);
  });
}

function apiAutoExpandDatabase(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const oldSs = ss_();
    const oldId = oldSs.getId();
    const tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
    const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    const label = (p.label && String(p.label).trim())
      ? String(p.label).trim()
      : ('Archived ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
    const companyName = getSettingsMap_().CompanyName || ('KLG ' + BRANCH.NAME);
    const newName = companyName + ' - Billing DB (' + timestamp + ')';

    const newSs = createFreshDatabaseSpreadsheet_(newName);
    copyMasterDataForward_(oldSs, newSs);

    const props = PropertiesService.getScriptProperties();
    const registry = getArchiveRegistry_();
    registry.push({ id: oldId, label: label, archivedAt: new Date().toISOString() });
    props.setProperty('ARCHIVE_SPREADSHEET_IDS', JSON.stringify(registry));
    props.setProperty('ACTIVE_SPREADSHEET_ID', newSs.getId()); resetSsCache_();
    props.setProperty('SchemaVersion', String(SCHEMA_VERSION));
    clearAllCache_();

    return {
      ok: true,
      archivedLabel: label,
      newSpreadsheetName: newName,
      newSpreadsheetUrl: newSs.getUrl(),
      newSpreadsheetId: newSs.getId()
    };
  } catch (err) {
    return { ok: false, error: 'Could not create the new database automatically: ' + err };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 4b. DATA DIAGNOSTICS & NUMBERING TOOLS
//     Bill / Customer / Product numbers come from counters kept in this
//     script's own properties (so numbering carries on across a database
//     switch). If someone edits the spreadsheet by hand, "Refresh Numbering"
//     re-syncs them; "Reset" re-bases on the active sheet only.
// ---------------------------------------------------------------------------
const ID_SPECS_ = {
  bill: { counter: 'IDCTR_BILL', sheet: 'BILLS' },
  customer: { counter: 'IDCTR_CUST', sheet: 'CUSTOMERS' },
  product: { counter: 'IDCTR_PROD', sheet: 'PRODUCTS' }
};
// KLG-CBE-000001 / KLG-CBE-C0001 / 0001
function formatId_(kind, n) {
  if (kind === 'bill') return idPrefix_() + '-' + Utilities.formatString('%06d', n);
  if (kind === 'customer') return idPrefix_() + '-C' + Utilities.formatString('%04d', n);
  return Utilities.formatString('%04d', n);
}

function apiGetDataDiagnostics(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;

  function dbInfo_(ssRef) {
    const billsSh = ssRef.getSheetByName(SHEET.BILLS);
    const custSh = ssRef.getSheetByName(SHEET.CUSTOMERS);
    const prodSh = ssRef.getSheetByName(SHEET.PRODUCTS);
    let totalCells = 0;
    ssRef.getSheets().forEach(function (sh) { totalCells += sh.getMaxRows() * sh.getMaxColumns(); });
    return {
      name: ssRef.getName(),
      url: ssRef.getUrl(),
      percentUsed: Math.round((totalCells / CAPACITY_CELL_LIMIT) * 1000) / 10,
      rowCounts: {
        bills: Math.max(0, (billsSh ? billsSh.getLastRow() : 1) - 1),
        customers: Math.max(0, (custSh ? custSh.getLastRow() : 1) - 1),
        products: Math.max(0, (prodSh ? prodSh.getLastRow() : 1) - 1)
      }
    };
  }

  const activeInfo = dbInfo_(ss_());
  const active = {
    name: activeInfo.name, url: activeInfo.url, percentUsed: activeInfo.percentUsed,
    rowCounts: activeInfo.rowCounts, reachable: true,
    nextBillId: nextSequentialId_('bill', false),
    nextCustomerId: nextSequentialId_('customer', false),
    nextProductId: nextSequentialId_('product', false)
  };

  const archives = getArchiveRegistry_().map(function (entry) {
    try {
      const info = dbInfo_(SpreadsheetApp.openById(entry.id));
      return { label: entry.label || entry.id, name: info.name, url: info.url, percentUsed: info.percentUsed, rowCounts: info.rowCounts, reachable: true };
    } catch (e) {
      return { label: entry.label || entry.id, name: '(not reachable - deleted or unshared)', url: '', percentUsed: 0, rowCounts: null, reachable: false };
    }
  });

  return { ok: true, active: active, archives: archives };
}

function apiResetToActiveOnly(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('ARCHIVE_SPREADSHEET_IDS');
    delete MEMO_.archives;
    const out = { ok: true };
    Object.keys(ID_SPECS_).forEach(function (kind) {
      const spec = ID_SPECS_[kind];
      const max = highestExistingIdSuffix_(ss_().getSheetByName(SHEET[spec.sheet]), 0);
      props.setProperty(spec.counter, String(max));
      out['next' + kind.charAt(0).toUpperCase() + kind.slice(1) + 'Id'] = formatId_(kind, max + 1);
    });
    return out;
  } catch (err) {
    return { ok: false, error: 'Could not reset: ' + err };
  } finally {
    lock.releaseLock();
  }
}

function apiRefreshNumbering(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const archives = openArchives_();
    const out = { ok: true, archivesScanned: archives.length };
    Object.keys(ID_SPECS_).forEach(function (kind) {
      const spec = ID_SPECS_[kind];
      const max = highestAcrossDbs_(SHEET[spec.sheet]);
      props.setProperty(spec.counter, String(max));
      out['next' + kind.charAt(0).toUpperCase() + kind.slice(1) + 'Id'] = formatId_(kind, max + 1);
    });
    return out;
  } catch (err) {
    return { ok: false, error: 'Could not refresh numbering: ' + err };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 4c. CAPACITY MONITORING - Google's per-spreadsheet ceiling is ~1 crore
//     (10,000,000) cells. Super Admin is warned from 75%; at 98% new bills
//     are refused (on screen AND here) until a new database is added.
// ---------------------------------------------------------------------------
const CAPACITY_CELL_LIMIT = 10000000;
const CAPACITY_WARNING_THRESHOLD = 0.75;
const CAPACITY_BLOCK_THRESHOLD = 0.98;

function apiGetCapacityStatus() {
  return cached_('capacity', function () {
    let totalCells = 0;
    ss_().getSheets().forEach(sh => { totalCells += sh.getMaxRows() * sh.getMaxColumns(); });
    const pct = totalCells / CAPACITY_CELL_LIMIT;
    return {
      ok: true,
      totalCells: totalCells,
      limit: CAPACITY_CELL_LIMIT,
      percentUsed: Math.round(pct * 1000) / 10,
      warning: pct >= CAPACITY_WARNING_THRESHOLD,
      blocked: pct >= CAPACITY_BLOCK_THRESHOLD
    };
  });
}

// ---------------------------------------------------------------------------
// 5. SETTINGS API
// ---------------------------------------------------------------------------
function settingOn_(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const t = String(v == null ? '' : v).trim().toUpperCase();
  return !(t === 'FALSE' || t === '0' || t === 'NO' || t === '');
}
function themeFields_(s) {
  const out = {};
  THEME_SETTING_DEFAULTS.forEach(function (pair) {
    out[pair[0]] = (s[pair[0]] !== undefined && s[pair[0]] !== '') ? s[pair[0]] : pair[1];
  });
  return out;
}

// PUBLIC (no login) - only what the login screen needs: name, logo, colours.
// Bank details, GSTIN, phone numbers etc. are NOT included here.
function apiGetSettingsPublic() {
  const s = getSettingsMap_();
  return {
    ok: true,
    settings: Object.assign({
      CompanyName: s.CompanyName || '',
      AppTitle: s.AppTitle || '',
      LogoURL: s.LogoURL || '',
      PrintLogoURL: s.PrintLogoURL || ''
    }, themeFields_(s)),
    serverBuild: BACKEND_BUILD,
    setupDone: !!superAdminConfig_()
  };
}

// Everything the logged-in screens need (served only inside bootstrap).
function apiGetSettingsFull_() {
  const s = getSettingsMap_();
  const flag = function (k) { return (s[k] === undefined || s[k] === '') ? true : settingOn_(s[k]); };
  const flagOff = function (k) { return (s[k] === undefined || s[k] === '') ? false : settingOn_(s[k]); };
  return Object.assign({
    CompanyName: s.CompanyName || '',
    AppTitle: s.AppTitle || '',
    Address: s.Address || '',
    Phone: s.Phone || '',
    Website: s.Website || '',
    GSTNumber: s.GSTNumber || '',
    LogoURL: s.LogoURL || '',
    PrintLogoURL: s.PrintLogoURL || '',
    LetterheadLogoURL: s.LetterheadLogoURL || '',
    Currency: s.Currency || 'INR',
    CompanyEmail: s.CompanyEmail || '',
    CGSTPercent: Number(s.CGSTPercent) || 0,
    SGSTPercent: Number(s.SGSTPercent) || 0,
    BankName: s.BankName || '',
    BankAccountNo: s.BankAccountNo || '',
    BankIFSC: s.BankIFSC || '',
    BankAccountHolder: s.BankAccountHolder || '',
    AuthorizedSignatoryLabel: s.AuthorizedSignatoryLabel || 'Authorized Signatory',
    ShowCompanyEmail: flag('ShowCompanyEmail'),
    ShowTaxOnBill: flag('ShowTaxOnBill'),
    ShowBankDetails: flag('ShowBankDetails'),
    ShowDiscountOption: flag('ShowDiscountOption'),
    ShowAuthorizedSignatory: flag('ShowAuthorizedSignatory'),
    ShowHSNOnBill: flagOff('ShowHSNOnBill'),
    ShowAmountInWords: flag('ShowAmountInWords'),
    ShowTerms: flagOff('ShowTerms'),
    TermsText: s.TermsText || '',
    SocialWhatsApp: s.SocialWhatsApp || '',
    SocialInstagram: s.SocialInstagram || '',
    SocialFacebook: s.SocialFacebook || '',
    SocialLinkedIn: s.SocialLinkedIn || '',
    SocialYouTube: s.SocialYouTube || '',
    BillIdPrefix: idPrefix_(),
    BranchCode: BRANCH.CODE,
    BranchName: BRANCH.NAME
  }, themeFields_(s));
}

function apiUpdateSettings(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const upper = function (v) { return v.toUpperCase().replace(/\s/g, ''); };
  const boolField = function (label) {
    return function (raw) { return vOneOf_(String(raw).toUpperCase(), label, ['TRUE', 'FALSE']); };
  };
  const validators = {
    CompanyName: function (v) { return vFreeText_(v, 'Shop Name', 80, true, 2); },
    AppTitle: function (v) { return vFreeText_(v, 'App Title', 60, false); },
    Address: function (v) { return vAddress_(v, 'Address'); },
    Phone: function (v) { return vShopPhone_(v, 'Phone'); },
    Website: function (v) { return vPattern_(v, 'Website', VR.WEBSITE, 100, 'is not a valid website (e.g. www.example.com).', function (x) { return x.replace(/\s/g, ''); }); },
    GSTNumber: function (v) { return vPattern_(v, 'GST Number', VR.GSTIN, 15, 'must be a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5).', upper); },
    LogoURL: function (v) { return vUrl_(v, 'App Logo URL'); },
    PrintLogoURL: function (v) { return vUrl_(v, 'Bill Logo URL'); },
    LetterheadLogoURL: function (v) { return vUrl_(v, 'Letterhead Logo URL'); },
    CompanyEmail: function (v) { return vEmail_(v, 'Shop Email', false); },
    CGSTPercent: function (v) { return vPercent_(v, 'CGST %'); },
    SGSTPercent: function (v) { return vPercent_(v, 'SGST %'); },
    BankName: function (v) { return vOrgName_(v, 'Bank Name', 60); },
    BankAccountNo: function (v) { return vPattern_(v, 'Account Number', VR.ACCOUNT_NO, 18, 'must be 9 to 18 digits (digits only).', function (x) { return x.replace(/\s/g, ''); }); },
    BankIFSC: function (v) { return vPattern_(v, 'IFSC Code', VR.IFSC, 11, 'must be a valid 11-character IFSC (e.g. YESB0000123).', upper); },
    BankAccountHolder: function (v) { return vOrgName_(v, 'Account Holder Name', 80); },
    AuthorizedSignatoryLabel: function (v) { return vFreeText_(v, 'Signatory Label', 40, false); },
    TermsText: function (v) { return vMultiText_(v, 'Terms & Conditions', VLIMIT.TERMS_MAX); },
    ShowCompanyEmail: boolField('Show Shop Email'),
    ShowTaxOnBill: boolField('Allow tax'),
    ShowBankDetails: boolField('Show bank details'),
    ShowDiscountOption: boolField('Allow discounts'),
    ShowAuthorizedSignatory: boolField('Show signature box'),
    ShowHSNOnBill: boolField('Show HSN column'),
    ShowAmountInWords: boolField('Show amount in words'),
    ShowTerms: boolField('Show Terms & Conditions'),
    SocialWhatsApp: function (v) { return vMobile_(v, 'WhatsApp Number', false); },
    SocialInstagram: function (v) { return vUrl_(v, 'Instagram URL'); },
    SocialFacebook: function (v) { return vUrl_(v, 'Facebook URL'); },
    SocialLinkedIn: function (v) { return vUrl_(v, 'LinkedIn URL'); },
    SocialYouTube: function (v) { return vUrl_(v, 'YouTube URL'); }
  };

  // Only fields whose value actually CHANGED are validated.
  const current = getSettingsMap_();
  const toWrite = {};
  const keys = Object.keys(validators);
  for (let i = 0; i < keys.length; i++) {
    const f = keys[i];
    if (p[f] === undefined || p[f] === null) continue;
    if (String(p[f]) === String(current[f] == null ? '' : current[f])) continue;
    const r = validators[f](p[f]);
    if (r.error) return { ok: false, error: r.error, field: f };
    toWrite[f] = r.value;
  }

  // Changing the Super Admin's own login (Admin Settings -> My Login).
  if (p.newSuperAdminUser || p.newSuperAdminPass) {
    const cfg = superAdminConfig_();
    let newUser = cfg.user;
    if (p.newSuperAdminUser) {
      const u = vLine_(p.newSuperAdminUser);
      if (u.length < 3 || u.length > 40 || !VR.ADMIN_USER.test(u)) {
        return { ok: false, error: 'New Super Admin username must be 3 to 40 characters - letters, numbers, spaces and . _ - @ only.', field: 'newSuperAdminUser' };
      }
      if (findBillerRow_(u)) return { ok: false, error: 'That username is already used as a Biller ID. Pick another.', field: 'newSuperAdminUser' };
      newUser = u;
    }
    if (p.newSuperAdminPass) {
      const pw = vPassword_(p.newSuperAdminPass, 'New Super Admin password', 8, true);
      if (pw.error) return { ok: false, error: pw.error, field: 'newSuperAdminPass' };
      setSuperAdmin_(newUser, pw.value);
    } else {
      PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_USER', newUser);
    }
  }
  setSettings_(toWrite);
  return { ok: true };
}

// Theme values are validated by KIND, inferred from each key's default -
// this stops a crafted request injecting arbitrary CSS into everyone's screen.
const THEME_STYLES_ = ['solid', 'gradient-diagonal', 'gradient-vertical', 'gradient-horizontal'];
function vThemeValue_(key, raw, def) {
  const v = String(raw == null ? '' : raw).trim();
  if (VR.HEX_COLOR.test(def)) return VR.HEX_COLOR.test(v) ? vRes_(v) : vRes_(v, key + ' must be a colour like #1A2B3C.');
  if (def === 'TRUE' || def === 'FALSE') return vOneOf_(v.toUpperCase(), key, ['TRUE', 'FALSE']);
  if (/Style$/.test(key)) return vOneOf_(v, key, THEME_STYLES_);
  if (key === 'ThemeBillHeaderLayout') return vOneOf_(v, key, ['logo-side', 'logo-top']);
  if (key === 'ThemeBillLogoWidth' || key === 'ThemeBillLogoHeight') {
    const n = vInt_(Math.round(Number(v)), 'Logo size', 20, 400, true);
    return n.error ? n : vRes_(String(n.value));
  }
  if (key === 'ThemeChartPalette') {
    const parts = v.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
    if (!parts.length || parts.length > 12 || parts.some(function (c) { return !VR.HEX_COLOR.test(c); })) {
      return vRes_(v, 'Chart colours must be 1 to 12 colours like #1A2B3C.');
    }
    return vRes_(parts.join(','));
  }
  if (key === 'ThemeBillFontFamily') {
    if (!v || v.length > 120 || /[;{}<>\\]/.test(v)) return vRes_(v, 'Bill font is not valid.');
    return vRes_(v);
  }
  return /[;{}<>\\]/.test(v) || v.length > 120 ? vRes_(v, key + ' is not valid.') : vRes_(v);
}

function apiUpdateTheme(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const current = getSettingsMap_();
  const toWrite = {};
  for (let i = 0; i < THEME_SETTING_DEFAULTS.length; i++) {
    const f = THEME_SETTING_DEFAULTS[i][0];
    if (p[f] === undefined || p[f] === null || p[f] === '') continue;
    if (String(p[f]) === String(current[f] == null ? '' : current[f])) continue;
    const r = vThemeValue_(f, p[f], THEME_SETTING_DEFAULTS[i][1]);
    if (r.error) return { ok: false, error: r.error, field: f };
    toWrite[f] = r.value;
  }
  setSettings_(toWrite);
  return { ok: true };
}

function apiResetTheme(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const map = {};
  THEME_SETTING_DEFAULTS.forEach(pair => { map[pair[0]] = pair[1]; });
  setSettings_(map);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 6. LOGIN
// ---------------------------------------------------------------------------
function apiLogin(p) {
  const uname = vLine_(p.username).slice(0, 60);
  const pwd = String(p.password == null ? '' : p.password).slice(0, 60);
  if (!uname || !pwd) return { ok: false, error: 'Please enter both username and password.' };
  if (isLockedOut_(uname)) return { ok: false, error: LOCKED_MSG_ };

  const cfg = superAdminConfig_();
  if (cfg && uname === cfg.user) {
    if (verifyPassword_(pwd, cfg.hash)) {
      clearFailedLogins_(uname);
      const token = createSession_({ role: 'admin', user: cfg.user, pwTag: pwTag_(cfg.hash), at: Date.now() });
      return { ok: true, role: 'admin', displayName: 'Super Admin', sessionToken: token };
    }
    noteFailedLogin_(uname);
    return { ok: false, error: 'Invalid username or password.' };
  }

  // Not the Super Admin - try a biller's own login (Biller ID + password).
  const b = findBillerRow_(uname);
  if (b && verifyPassword_(pwd, b.hash)) {
    if (!b.active) return { ok: false, error: 'This biller ID is deactivated. Please contact the Super Admin.' };
    clearFailedLogins_(uname);
    const token = createSession_({ role: 'biller', billerId: b.id, billerName: b.name, pwTag: pwTag_(b.hash), at: Date.now() });
    return Object.assign({ ok: true, role: 'biller', displayName: b.name, billerId: b.id, billerName: b.name, sessionToken: token }, b.perms);
  }
  noteFailedLogin_(uname);
  if (!cfg) return { ok: false, error: NOT_SET_UP_MSG_ };
  return { ok: false, error: 'Invalid username or password.' };
}

// Every Admin Settings action: the person must be logged in AS the Super
// Admin AND re-type the Super Admin username/password on that page (kept
// only in the page's memory, never saved). Belt and braces for the most
// powerful actions in the app.
function requireSuperAdmin_(user, pass) {
  if (!isAdminSession_()) return { ok: false, error: 'Only the Super Admin can do this. Please log in as Super Admin.' };
  const cfg = superAdminConfig_();
  if (!cfg) return { ok: false, error: NOT_SET_UP_MSG_ };
  const key = 'admin-confirm';
  if (isLockedOut_(key)) return { ok: false, error: LOCKED_MSG_ };
  if (vLine_(user) === cfg.user && verifyPassword_(String(pass || ''), cfg.hash)) {
    clearFailedLogins_(key);
    return { ok: true };
  }
  noteFailedLogin_(key);
  return { ok: false, error: 'Super Admin username or password is incorrect.' };
}

// ---------------------------------------------------------------------------
// 7. BOOTSTRAP (everything the billing screen needs on load)
// ---------------------------------------------------------------------------
function apiBootstrap() {
  const perms = currentPerms_();
  return {
    ok: true,
    settings: apiGetSettingsFull_(),
    products: apiGetProducts(false).products,
    billers: apiGetBillers().billers.filter(b => b.active),
    customers: apiGetCustomersList().customers,
    nextBillId: nextSequentialId_('bill', false),
    serverBuild: BACKEND_BUILD,
    // Who is logged in, straight from the server-side session - the screen
    // uses THIS (not anything stored in the browser) to decide what to show.
    me: isAdminSession_()
      ? Object.assign({ role: 'admin', displayName: 'Super Admin' }, perms)
      : Object.assign({ role: 'biller', displayName: SESSION_.billerName, billerId: SESSION_.billerId, billerName: SESSION_.billerName }, perms)
  };
}

// Lightweight list of all customers (id + name + phone) - powers the instant
// "customers on this number" list and the Dashboard customer filter.
function apiGetCustomersList() {
  const customers = cached_('customers', function () {
    const sh = ss_().getSheetByName(SHEET.CUSTOMERS);
    const data = sh.getDataRange().getValues();
    const out = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      out.push({ id: String(row[0]), name: row[1], phone: row[2] });
    }
    return out;
  });
  return { ok: true, customers: customers };
}

// ---------------------------------------------------------------------------
// 8. CUSTOMERS
// ---------------------------------------------------------------------------
// A customer is identified by PHONE + NAME TOGETHER, never by phone alone -
// several people (e.g. a hotel's owner and its manager, or family members)
// often share one number, and each gets their own Customer ID.
//   - Phone compared as a normalised 10-digit number.
//   - Name compared ignoring capitals and extra spaces.
// Every lookup also returns `onPhone` - ALL customers registered on that
// number (oldest first) - so the biller can type just the phone number and
// pick who the bill is for.
function customerNameKey_(v) { return vLine_(v).toLowerCase(); }
const CUSTOMERS_PER_PHONE_MAX = 50;

function apiFindCustomer(phone, name, opts) {
  const wantPhone = normalizeMobile_(phone);
  const wantName = customerNameKey_(name);
  if (!/^[6-9]\d{9}$/.test(wantPhone)) return { ok: true, found: false, samePhone: [], onPhone: [] };
  const sh = ss_().getSheetByName(SHEET.CUSTOMERS);
  const data = sh.getDataRange().getValues();
  const list = [];
  let match = null;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] || normalizeMobile_(row[2]) !== wantPhone) continue;
    const c = customerSummary_(row);
    if (!match && wantName && customerNameKey_(row[1]) === wantName) match = c;
    if (list.length < CUSTOMERS_PER_PHONE_MAX) list.push(c);
  }
  if (opts && opts.withVisits && list.length) {
    try {
      const visits = lastVisitsFor_(list.map(c => c.customerId));
      list.forEach(c => { c.lastVisit = visits[c.customerId] || ''; });
    } catch (e) {
      Logger.log('Last-purchase lookup skipped: ' + e);
    }
  }
  const samePhone = list.filter(c => c !== match);
  if (match) return { ok: true, found: true, customer: match, samePhone: samePhone, onPhone: list };
  return { ok: true, found: false, samePhone: samePhone, onPhone: list };
}

// The details the billing screen fills in when a customer is picked.
function customerSummary_(row) {
  const str = v => (v === null || v === undefined) ? '' : String(v);
  return {
    customerId: str(row[0]), name: vLine_(row[1]), phone: normalizeMobile_(row[2]) || str(row[2]),
    email: str(row[3]), address: str(row[4]), deliveryAddress: str(row[5]),
    companyName: str(row[7]), customerGstin: str(row[8])
  };
}

function billDateStr_(v, ssRef) {
  if (v instanceof Date) return fmtDate_(v, 'yyyy-MM-dd', ssRef);
  const t = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}

// Latest bill date per Customer ID. Archives never change, so answers from
// them are cached for 6 hours.
const LAST_VISIT_CACHE_PREFIX_ = 'lv_arch_';
function lastVisitsFor_(ids) {
  const want = {};
  ids.forEach(id => { if (id) want[String(id)] = true; });
  const out = {};
  const scan = function (ssRef, onlyIds) {
    const sh = ssRef.getSheetByName(SHEET.BILLS);
    if (!sh || sh.getLastRow() < 2) return;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    for (let i = 0; i < rows.length; i++) {
      const pid = String(rows[i][2] || '');
      if (!pid || !onlyIds[pid]) continue;
      const d = billDateStr_(rows[i][1], ssRef);
      if (d && (!out[pid] || d > out[pid])) out[pid] = d;
    }
  };
  scan(ss_(), want);

  const missing = Object.keys(want).filter(id => !out[id]);
  if (!missing.length || !getArchiveRegistry_().length) return out;
  const cache = CacheService.getScriptCache();
  const cachedVals = cache.getAll(missing.map(id => LAST_VISIT_CACHE_PREFIX_ + id));
  const stillMissing = {};
  missing.forEach(id => {
    const hit = cachedVals[LAST_VISIT_CACHE_PREFIX_ + id];
    if (hit === undefined || hit === null) stillMissing[id] = true;
    else if (hit !== '-') out[id] = hit;
  });
  if (!Object.keys(stillMissing).length) return out;
  openArchives_().forEach(a => scan(a.ss, stillMissing));
  const toCache = {};
  Object.keys(stillMissing).forEach(id => { toCache[LAST_VISIT_CACHE_PREFIX_ + id] = out[id] || '-'; });
  cache.putAll(toCache, 21600);
  return out;
}

// ---------------------------------------------------------------------------
// FIND BILLS BY PHONE (Find / Edit Bill screen) - every bill on this number,
// across the active database AND every archive, newest first.
// ---------------------------------------------------------------------------
const BILLS_BY_PHONE_MAX = 300;
function apiGetBillsByPhone(phone) {
  const want = normalizeMobile_(phone);
  if (!/^[6-9]\d{9}$/.test(want)) {
    return { ok: false, error: 'Enter a 10-digit mobile number (digits only) to find bills by phone.' };
  }
  const settings = getSettingsMap_();
  const bills = [];
  let total = 0;
  allDbs_().forEach(db => {
    const sh = db.ss.getSheetByName(SHEET.BILLS);
    if (!sh || sh.getLastRow() < 2) return;
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(BILLS_HEADERS.length, sh.getLastColumn())).getValues();
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      if (!r[0] || normalizeMobile_(r[4]) !== want) continue;
      total++;
      const net = Number(r[10]) || 0;
      const grand = computeTax_(net, settings, boolText_(r[20])).grandTotal;
      bills.push({
        billId: String(r[0]), date: billDateStr_(r[1], db.ss), customerId: String(r[2] || ''),
        customerName: vLine_(r[3]), companyName: String(r[23] || ''), totalAmount: Math.round(grand * 100) / 100,
        paymentMethod: String(r[8] || ''), paymentStatus: String(r[11] || ''),
        source: db.label, editable: db.label === 'Active'
      });
    }
  });
  bills.sort((a, b) => (a.date === b.date ? (a.billId < b.billId ? 1 : -1) : (a.date < b.date ? 1 : -1)));
  return { ok: true, phone: want, total: total, truncated: bills.length > BILLS_BY_PHONE_MAX, bills: bills.slice(0, BILLS_BY_PHONE_MAX) };
}

// Validates/cleans the customer fields of a new bill (or a direct
// saveCustomer call). Returns { ok, values } or { ok:false, error, field }.
function validateCustomerFields_(p) {
  let nameCheck = vPersonName_(p.customerName, 'Customer Name', true);
  // An EXISTING customer's name (same phone + name already registered) is
  // accepted exactly as it was saved.
  if (nameCheck.error && vLine_(p.customerName)) {
    const ph = normalizeMobile_(p.phone);
    if (/^[6-9]\d{9}$/.test(ph) && apiFindCustomer(ph, p.customerName).found) nameCheck = vRes_(vLine_(p.customerName));
  }
  return vCollect_([
    ['customerName', nameCheck],
    ['phone', vMobile_(p.phone, 'Phone Number', true)],
    ['email', vEmail_(p.email, 'Email', false)],
    ['address', vAddress_(p.address, 'Address')],
    ['deliveryAddress', vAddress_(p.deliveryAddress, 'Delivery Address')],
    ['companyName', vOrgName_(p.companyName, 'Company Name', 80)],
    ['customerGstin', vGstin_(p.customerGstin, 'Customer GSTIN')]
  ]);
}

// skipLock=true when the caller (apiSaveBill) already holds the script lock.
function apiSaveCustomer(p, skipLock) {
  if (!skipLock) {
    const check = validateCustomerFields_(p);
    if (!check.ok) return check;
    p = Object.assign({}, p, check.values);
  }
  const doWork = () => {
    const sh = ss_().getSheetByName(SHEET.CUSTOMERS);
    const id = nextSequentialId_('customer', true);
    sh.appendRow([id, cellSafe_(p.customerName || ''), p.phone || '', cellSafe_(p.email || ''), cellSafe_(p.address || ''),
      cellSafe_(p.deliveryAddress || ''), new Date(), cellSafe_(p.companyName || ''), p.customerGstin || '']);
    invalidateCache_('customers');
    return { ok: true, customerId: id };
  };
  if (skipLock) return doWork();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return doWork(); } finally { lock.releaseLock(); }
}

// Returns true if the customer exists (and was refreshed), false otherwise.
// With requireIdentityMatch, a customer whose stored phone OR name differs
// from the bill is NOT touched - so a Customer ID left in the form after
// the phone or name changed can never attach a bill to someone else.
function updateCustomerIfChanged_(customerId, p, requireIdentityMatch) {
  const sh = ss_().getSheetByName(SHEET.CUSTOMERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(customerId)) {
      if (requireIdentityMatch) {
        if (normalizeMobile_(data[i][2]) !== normalizeMobile_(p.phone)) return false;
        if (customerNameKey_(data[i][1]) !== customerNameKey_(p.customerName)) return false;
      }
      const row = data[i];
      // Only overwrite a field when a new value was actually provided. The
      // saved name and phone (the customer's identity) are kept as they are.
      const next = [
        vLine_(row[1]) ? keepType_(row[1]) : cellSafe_(p.customerName || ''),
        keepType_(row[2]),
        p.email ? cellSafe_(p.email) : keepType_(row[3]),
        p.address ? cellSafe_(p.address) : keepType_(row[4]),
        p.deliveryAddress ? cellSafe_(p.deliveryAddress) : keepType_(row[5]),
        keepType_(row[6]),
        p.companyName ? cellSafe_(p.companyName) : keepType_(row[7] == null ? '' : row[7]),
        p.customerGstin ? p.customerGstin : keepType_(row[8] == null ? '' : row[8])
      ];
      const same = next.every((v, k) => String(v).replace(/^'/, '') === String(row[k + 1] == null ? '' : row[k + 1]));
      if (!same) { sh.getRange(i + 1, 2, 1, 8).setValues([next]); invalidateCache_('customers'); }
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 9. PRODUCTS
// ---------------------------------------------------------------------------
function productsAll_() {
  return cached_('products', function () {
    const sh = ss_().getSheetByName(SHEET.PRODUCTS);
    const data = sh.getDataRange().getValues();
    const products = [];
    for (let i = 1; i < data.length; i++) {
      const [id, name, price, active, , stockRaw, thresholdRaw, hsn] = data[i];
      if (!name) continue;
      // stock === null means "not tracked" (never given a starting count).
      const tracked = stockRaw !== '' && stockRaw !== null && stockRaw !== undefined;
      products.push({
        id: String(id), name: name, defaultPrice: price, active: isTrue_(active),
        stock: tracked ? Number(stockRaw) : null,
        lowStockThreshold: (thresholdRaw !== '' && thresholdRaw !== null && thresholdRaw !== undefined) ? Number(thresholdRaw) : 5,
        hsn: hsn == null ? '' : String(hsn)
      });
    }
    return products;
  });
}
function apiGetProducts(includeInactive) {
  const all = productsAll_();
  return { ok: true, products: includeInactive ? all : all.filter(p => p.active) };
}

// name (lower-cased) -> true, for every product in the list.
function productNameIndex_() {
  const idx = {};
  productsAll_().forEach(p => { idx[String(p.name).trim().toLowerCase()] = true; });
  return idx;
}
// name (lower-cased) -> HSN code, used to stamp each bill line.
function productHsnIndex_() {
  const idx = {};
  productsAll_().forEach(p => { idx[vLine_(p.name).toLowerCase()] = p.hsn || ''; });
  return idx;
}

// Validates the editable product fields. Any OTHER product with the same
// name is a duplicate - stock is matched by name.
function validateProductFields_(p, existing, excludeId) {
  let name;
  const typed = vLine_(p.name);
  if (existing && typed === vLine_(existing.name)) {
    name = vRes_(typed);
  } else {
    name = vProductName_(p.name, 'Product name');
  }
  if (name.error) return { ok: false, error: name.error, field: 'name' };
  const clash = productsAll_().find(x => (excludeId == null || String(x.id) !== String(excludeId)) && vLine_(x.name).toLowerCase() === name.value.toLowerCase());
  if (clash) {
    return { ok: false, field: 'name', error: '"' + vLine_(clash.name) + '" already exists in the list' + (clash.active ? '.' : ' (currently inactive - switch it back on in Admin Settings > Products).') };
  }
  const price = vMoney_(p.defaultPrice, 'Default Price', false);
  if (price.error) return { ok: false, error: price.error, field: 'defaultPrice' };
  const stock = vInt_(p.stock, 'Stock', 0, VLIMIT.STOCK_MAX, false, '');
  if (stock.error) return { ok: false, error: stock.error, field: 'stock' };
  const thr = vInt_(p.lowStockThreshold, 'Low Stock Alert', 0, VLIMIT.THRESHOLD_MAX, false, '');
  if (thr.error) return { ok: false, error: thr.error, field: 'lowStockThreshold' };
  const hsn = vHsn_(p.hsn, 'HSN Code');
  if (hsn.error) return { ok: false, error: hsn.error, field: 'hsn' };
  return { ok: true, name: name.value, defaultPrice: price.value, stock: stock.value, lowStockThreshold: thr.value, hsn: hsn.value };
}

// Any logged-in user can add a product - billers need this to add a new
// item straight from the bill. Editing/deleting is Super Admin only.
function apiAddProduct(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const v = validateProductFields_(p, null, null);
    if (!v.ok) return v;
    const sh = ss_().getSheetByName(SHEET.PRODUCTS);
    const id = nextSequentialId_('product', true);
    const hasStock = v.stock !== '';
    const stockVal = hasStock ? v.stock : '';
    const thresholdVal = v.lowStockThreshold !== '' ? v.lowStockThreshold : 5;
    sh.appendRow([asText_(id), cellSafe_(v.name), v.defaultPrice, true, new Date(), stockVal, thresholdVal, v.hsn ? asText_(v.hsn) : '']);
    invalidateCache_('products');
    if (hasStock) logStockChange_(id, v.name, 'Initial Stock', stockVal, stockVal, '', sessionRole_(), sessionName_(), sessionBillerId_());
    return { ok: true, productId: id, name: v.name, defaultPrice: v.defaultPrice, hsn: v.hsn };
  } finally {
    lock.releaseLock();
  }
}

function apiUpdateProduct(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const sh = ss_().getSheetByName(SHEET.PRODUCTS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.productId)) {
      const v = validateProductFields_(p, { name: data[i][1] }, data[i][0]);
      if (!v.ok) return v;
      sh.getRange(i + 1, 2, 1, 3).setValues([[cellSafe_(v.name), v.defaultPrice, p.active !== false]]);
      if (v.stock !== '') sh.getRange(i + 1, 6).setValue(v.stock);
      if (v.lowStockThreshold !== '') sh.getRange(i + 1, 7).setValue(v.lowStockThreshold);
      if (p.hsn !== undefined) sh.getRange(i + 1, 8).setValue(v.hsn ? asText_(v.hsn) : '');
      invalidateCache_('products');
      return { ok: true, name: v.name, defaultPrice: v.defaultPrice, hsn: v.hsn };
    }
  }
  return { ok: false, error: 'Product not found' };
}

function apiDeleteProduct(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const sh = ss_().getSheetByName(SHEET.PRODUCTS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.productId)) {
      sh.deleteRow(i + 1);
      invalidateCache_('products');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Product not found' };
}

// ---------------------------------------------------------------------------
// 9b. LIVE STOCK / INVENTORY
// ---------------------------------------------------------------------------
function sessionRole_() { return isAdminSession_() ? 'Super Admin' : 'Biller'; }
function sessionName_() { return isAdminSession_() ? 'Super Admin' : (SESSION_ ? SESSION_.billerName : 'System'); }
function sessionBillerId_() { return isAdminSession_() || !SESSION_ ? '' : SESSION_.billerId; }

// The logged-in session decides who is changing stock - no password needed
// again. Super Admin always may; a biller needs the Stock Edit switch.
function authorizeStockAccess_(needEdit) {
  if (isAdminSession_()) return { ok: true, performerRole: 'Super Admin', performerName: 'Super Admin', performerId: '' };
  const perms = currentPerms_();
  if (needEdit && !perms.canAccessStockEdit) return { ok: false, error: 'You do not have Stock Edit access. Ask the Super Admin to switch it on.' };
  if (!needEdit && !perms.canAccessStockView && !perms.canAccessStockEdit) return { ok: false, error: 'You do not have Stock View access.' };
  return { ok: true, performerRole: 'Biller', performerName: SESSION_.billerName, performerId: SESSION_.billerId };
}

function apiSetProductStock(p) {
  const auth = authorizeStockAccess_(true);
  if (!auth.ok) return auth;

  let result = null, dailyNeeded = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ss_().getSheetByName(SHEET.PRODUCTS);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(p.productId)) {
        const current = (data[i][5] === '' || data[i][5] === null || data[i][5] === undefined) ? 0 : Number(data[i][5]);
        let newStock;
        if (p.mode === 'adjust') {
          const delta0 = vInt_(p.value, 'Stock change', -VLIMIT.STOCK_MAX, VLIMIT.STOCK_MAX, true);
          if (delta0.error) return { ok: false, error: delta0.error };
          newStock = current + delta0.value;
        } else {
          const set0 = vInt_(p.value, 'Stock', 0, VLIMIT.STOCK_MAX, true);
          if (set0.error) return { ok: false, error: set0.error };
          newStock = set0.value;
        }
        if (newStock < 0) return { ok: false, error: 'Stock cannot be set below zero' };
        if (newStock > VLIMIT.STOCK_MAX) return { ok: false, error: 'Stock cannot be more than ' + VLIMIT.STOCK_MAX + '.' };
        const thr = vInt_(p.lowStockThreshold, 'Low Stock Alert', 0, VLIMIT.THRESHOLD_MAX, false, '');
        if (thr.error) return { ok: false, error: thr.error };
        if (thr.value !== '') sh.getRange(i + 1, 6, 1, 2).setValues([[newStock, thr.value]]);
        else sh.getRange(i + 1, 6).setValue(newStock);
        invalidateCache_('products');
        const delta = newStock - current;
        if (delta !== 0) {
          logStockChange_(data[i][0], data[i][1], 'Manual Adjustment', delta, newStock, '',
            auth.performerRole, auth.performerName, auth.performerId);
          if (delta > 0) dailyNeeded = true;
        }
        result = { ok: true, productId: String(data[i][0]), newStock: newStock };
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
  if (dailyNeeded) refreshMirrorSheets_({ daily: true });
  return result || { ok: false, error: 'Product not found' };
}

// Deducts (sign=-1) or restores (sign=+1) stock for a set of bill lines,
// matched by product NAME. Only touches products whose stock is tracked.
function applyStockChangeForItems_(items, billId, performerRole, performerName, performerId, sign) {
  if (!items || !items.length) return 0;
  const sh = ss_().getSheetByName(SHEET.PRODUCTS);
  const data = sh.getDataRange().getValues();
  const rowByName = {};
  for (let i = 1; i < data.length; i++) {
    const k = vLine_(data[i][1]).toLowerCase();
    if (k && rowByName[k] === undefined) rowByName[k] = i;
  }
  const logRows = [];
  const touched = {};
  items.forEach(it => {
    const qty = Number(it.qty) || 0;
    if (!qty) return;
    const i = rowByName[vLine_(it.name).toLowerCase()];
    if (i === undefined) return;
    const stockRaw = data[i][5];
    const tracked = stockRaw !== '' && stockRaw !== null && stockRaw !== undefined;
    if (!tracked) return;
    const current = Number(stockRaw) || 0;
    const delta = sign * qty;
    const newStock = current + delta;
    data[i][5] = newStock;
    touched[i] = newStock;
    logRows.push(stockLogRow_(data[i][0], data[i][1], sign < 0 ? 'Sale' : 'Edit Reversal', delta, newStock, billId || '',
      performerRole, performerName, performerId));
  });
  Object.keys(touched).forEach(i => sh.getRange(Number(i) + 1, 6).setValue(touched[i]));
  if (Object.keys(touched).length) invalidateCache_('products');
  appendStockLogRows_(logRows);
  return logRows.length;
}

function stockLogRow_(productId, productName, changeType, delta, newStock, billId, performerRole, performerName, performerId) {
  const role = performerRole || 'System';
  const name = performerName || 'System';
  const id = performerId || '';
  const legacyLabel = id ? (role + ': ' + name + ' (' + id + ')') : (role + ': ' + name);
  return [new Date(), asText_(productId), cellSafe_(String(productName)), changeType, delta, newStock, billId || '',
    cellSafe_(legacyLabel), role, cellSafe_(String(name)), id];
}
function appendStockLogRows_(rows) {
  if (!rows || !rows.length) return;
  const sh = ss_().getSheetByName(SHEET.STOCK_LOG);
  if (!sh) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
function logStockChange_(productId, productName, changeType, delta, newStock, billId, performerRole, performerName, performerId) {
  appendStockLogRows_([stockLogRow_(productId, productName, changeType, delta, newStock, billId, performerRole, performerName, performerId)]);
}

function apiGetStockLog(params) {
  const sh = ss_().getSheetByName(SHEET.STOCK_LOG);
  if (!sh || sh.getLastRow() < 2) return { ok: true, log: [] };
  // Only the most recent rows are needed - read the tail, not the whole log.
  const take = Math.min(sh.getLastRow() - 1, 400);
  const data = sh.getRange(sh.getLastRow() - take + 1, 1, take, STOCK_LOG_HEADERS.length).getValues();
  const productId = (params && params.productId) || '';
  const log = [];
  for (let i = data.length - 1; i >= 0 && log.length < 60; i--) {
    const row = data[i];
    if (!row[0]) continue;
    if (productId && String(row[1]) !== String(productId)) continue;
    log.push({
      timestamp: row[0], productId: String(row[1]), productName: row[2], changeType: row[3],
      delta: row[4], newStock: row[5], billId: row[6], performedBy: row[7],
      performerRole: row[8] || '', performerName: row[9] || '', performerId: row[10] || ''
    });
  }
  return { ok: true, log: log };
}

// ---------------------------------------------------------------------------
// 10. BILLERS (Super Admin managed)
// ---------------------------------------------------------------------------
const BILLER_PERM_FIELDS_ = [
  'canAccessTax', 'canAccessBank', 'canAccessFindEdit', 'canAccessStockView', 'canAccessStockEdit',
  'canAccessReportDownload', 'canAccessDiscount', 'canAccessDashboard', 'canAccessLetterpad'
];
// Column number (1-based) of each permission in the Billers sheet.
const BILLER_PERM_COLS_ = {
  canAccessTax: 6, canAccessBank: 7, canAccessFindEdit: 8,
  canAccessStockView: 9, canAccessStockEdit: 10, canAccessReportDownload: 11,
  canAccessDiscount: 12, canAccessDashboard: 13, canAccessLetterpad: 14
};

// Every biller row, cached briefly. Includes the password HASH - this list
// stays on the server and is never sent to a browser as-is.
function billersRaw_() {
  return cached_('billers', function () {
    const sh = ss_().getSheetByName(SHEET.BILLERS);
    const data = sh.getDataRange().getValues();
    const out = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const perms = {};
      BILLER_PERM_FIELDS_.forEach(f => { perms[f] = isTrue_(row[BILLER_PERM_COLS_[f] - 1]); });
      out.push({ id: String(row[0]), name: row[1], hash: String(row[2] || ''), active: isTrue_(row[3]), perms: perms });
    }
    return out;
  });
}
function findBillerRow_(billerId) {
  const want = String(billerId || '').trim().toUpperCase();
  if (!want) return null;
  return billersRaw_().find(b => b.id.toUpperCase() === want) || null;
}

function apiGetBillers() {
  return {
    ok: true,
    billers: billersRaw_().map(b => Object.assign({ billerId: b.id, name: b.name, active: b.active }, b.perms))
  };
}

function apiSaveBiller(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const sh = ss_().getSheetByName(SHEET.BILLERS);
  const data = sh.getDataRange().getValues();
  const pass = vPassword_(p.password, 'Password', 6, !p.editBillerId);
  if (pass.error) return { ok: false, error: pass.error, field: 'password' };
  if (p.editBillerId) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(p.editBillerId)) {
        const sameName = vLine_(p.name) === vLine_(data[i][1]);
        const name = sameName ? vRes_(vLine_(p.name)) : vPersonName_(p.name, 'Biller Name', true);
        if (name.error) return { ok: false, error: name.error, field: 'name' };
        sh.getRange(i + 1, 2).setValue(cellSafe_(name.value));
        if (pass.value) sh.getRange(i + 1, 3).setValue(hashPassword_(pass.value));
        invalidateCache_('billers');
        return { ok: true, billerId: p.editBillerId };
      }
    }
    return { ok: false, error: 'Biller not found' };
  }
  const name = vPersonName_(p.name, 'Biller Name', true);
  if (name.error) return { ok: false, error: name.error, field: 'name' };
  // The next ID is always one past the highest ID ever present, so it can
  // never collide with an existing (or deleted-then-reused) one.
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][0] || '').match(/^B(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const id = 'B' + Utilities.formatString('%03d', max + 1);
  const cfg = superAdminConfig_();
  if (cfg && cfg.user.toUpperCase() === id) return { ok: false, error: 'The Super Admin username clashes with the next Biller ID (' + id + '). Change the Super Admin username first.' };
  sh.appendRow([id, cellSafe_(name.value), hashPassword_(pass.value), true, new Date(), false, false, false, false, false, false, false, false, false]);
  invalidateCache_('billers');
  return { ok: true, billerId: id };
}

function apiToggleBiller(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const sh = ss_().getSheetByName(SHEET.BILLERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.billerId)) {
      const cur = isTrue_(data[i][3]);
      sh.getRange(i + 1, 4).setValue(!cur);
      invalidateCache_('billers');
      return { ok: true, active: !cur };
    }
  }
  return { ok: false, error: 'Biller not found' };
}

function apiSetBillerAccess(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const col = BILLER_PERM_COLS_[p.field];
  if (!col) return { ok: false, error: 'Unknown permission field' };
  const sh = ss_().getSheetByName(SHEET.BILLERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.billerId)) {
      sh.getRange(i + 1, col).setValue(!!p.value);
      // Stock Edit needs Stock View: granting Edit grants View, removing
      // View removes Edit - enforced here so the two can never disagree.
      if (p.field === 'canAccessStockEdit' && p.value) sh.getRange(i + 1, BILLER_PERM_COLS_.canAccessStockView).setValue(true);
      if (p.field === 'canAccessStockView' && !p.value) sh.getRange(i + 1, BILLER_PERM_COLS_.canAccessStockEdit).setValue(false);
      invalidateCache_('billers');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Biller not found' };
}

function apiDeleteBiller(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const sh = ss_().getSheetByName(SHEET.BILLERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.billerId)) {
      sh.deleteRow(i + 1);
      invalidateCache_('billers');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Biller not found' };
}

// For a bill being saved: who is the biller? A biller who logged in with
// their own ID is identified by their session - no password asked again.
// When the Super Admin is logged in, the bill is saved ON BEHALF of a biller
// picked on screen, and that biller's own password confirms it.
function resolveBillerForSave_(p) {
  if (!isAdminSession_()) {
    const b = findBillerRow_(SESSION_.billerId);
    if (!b || !b.active) return { ok: false, error: 'This biller ID is deactivated' };
    return { ok: true, billerId: b.id, billerName: b.name, perms: b.perms };
  }
  const id = vLine_(p.billerId);
  if (!id || !p.billerPassword) return { ok: false, error: 'Choose the biller and enter their password to save this bill.' };
  const key = 'biller-confirm:' + id;
  if (isLockedOut_(key)) return { ok: false, error: LOCKED_MSG_ };
  const b = findBillerRow_(id);
  if (!b || !verifyPassword_(String(p.billerPassword), b.hash)) {
    noteFailedLogin_(key);
    return { ok: false, error: 'Invalid biller ID or password' };
  }
  clearFailedLogins_(key);
  if (!b.active) return { ok: false, error: 'This biller ID is deactivated' };
  // The Super Admin is at the counter, so tax / bank / discount are allowed.
  return { ok: true, billerId: b.id, billerName: b.name, perms: currentPerms_() };
}

// ---------------------------------------------------------------------------
// 11. ID HELPERS
// ---------------------------------------------------------------------------
// IDs come from a counter in this script's own Script Properties - NOT from
// counting rows - so numbering survives a database switch:
// KLG-CBE-004821 is always followed by KLG-CBE-004822. The first time a
// counter is used it starts from the highest ID already present (active
// spreadsheet AND every archive), so it never collides with issued IDs.
//
// consume=false is a pure PREVIEW (the "Next Bill ID" shown on screen).
// consume=true issues a real ID and must only run while the caller holds
// LockService.getScriptLock() for its whole read-then-write sequence.
function nextSequentialId_(kind, consume) {
  const spec = ID_SPECS_[kind];
  const props = PropertiesService.getScriptProperties();
  let current = Number(props.getProperty(spec.counter));
  if (!current || isNaN(current)) current = highestAcrossDbs_(SHEET[spec.sheet]);
  const next = current + 1;
  if (consume) props.setProperty(spec.counter, String(next));
  return formatId_(kind, next);
}

function highestAcrossDbs_(sheetName) {
  let max = highestExistingIdSuffix_(ss_().getSheetByName(sheetName), 0);
  openArchives_().forEach(a => {
    const sh = a.ss.getSheetByName(sheetName);
    if (sh) max = Math.max(max, highestExistingIdSuffix_(sh, 0));
  });
  return max;
}

function highestExistingIdSuffix_(sheet, idColIndex) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const data = sheet.getRange(2, idColIndex + 1, sheet.getLastRow() - 1, 1).getValues();
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const m = String(data[i][0] || '').match(/(\d+)\s*$/);
    if (m) { const n = Number(m[1]); if (n > max) max = n; }
  }
  return max;
}

// ---------------------------------------------------------------------------
// 12. SAVE BILL  (core transaction)
// ---------------------------------------------------------------------------
function apiSaveBill(p) {
  // 1. Who is billing - the logged-in biller, or (Super Admin at the
  //    counter) the biller picked on screen + that biller's password.
  const billerCheck = resolveBillerForSave_(p);
  if (!billerCheck.ok) return billerCheck;

  // 1a. Validate every field BEFORE taking the lock or touching the sheet.
  const customer = validateCustomerFields_(p);
  if (!customer.ok) return customer;
  const date = vDate_(p.date, 'Date');
  if (date.error) return { ok: false, error: date.error, field: 'date' };
  const method = vOneOf_(p.paymentMethod, 'Payment Method', PAYMENT_METHODS);
  if (method.error) return { ok: false, error: method.error, field: 'paymentMethod' };
  const billDisc = vPercent_(p.discountPercent || 0, 'Additional Discount %');
  if (billDisc.error) return { ok: false, error: billDisc.error, field: 'discountPercent' };
  const checkedItems = vItems_(p.items, productNameIndex_());
  if (checkedItems.error) return { ok: false, error: checkedItems.error, field: 'items' };
  const f = customer.values;

  // 1b. Hard stop if the active spreadsheet is essentially full.
  const capacity = apiGetCapacityStatus();
  if (capacity.ok && capacity.blocked) {
    return {
      ok: false,
      dbFull: true,
      error: 'This database is full and cannot accept new bills. Ask your Super Admin to add a new database (Admin Settings > Products > Database(s) Status) - it only takes one click.'
    };
  }

  // 1c. Duplicate-save guard: a repeat of the same one-time saveToken (e.g.
  // Save pressed again after a dropped connection) returns the bill that
  // was already created instead of making a second one.
  const saveToken = /^[A-Za-z0-9\-]{8,64}$/.test(String(p.saveToken || '')) ? String(p.saveToken) : '';
  const cache = CacheService.getScriptCache();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let result;
  try {
    if (saveToken) {
      const prior = cache.get('save_' + saveToken);
      if (prior) return JSON.parse(prior);
    }

    // 2. Resolve / create the customer by PHONE + NAME together.
    let customerId = String(p.customerId || '').trim();
    if (customerId && !updateCustomerIfChanged_(customerId, f, true)) customerId = '';
    if (!customerId) {
      const found = apiFindCustomer(f.phone, f.customerName);
      if (found.found) {
        customerId = found.customer.customerId;
        updateCustomerIfChanged_(customerId, f);
      } else {
        customerId = apiSaveCustomer(f, true).customerId;
      }
    }

    // 3. Totals - recomputed here from scratch. Tax / bank / discount are
    // only ever applied when this biller is allowed them.
    const settingsMap = getSettingsMap_();
    const perms = billerCheck.perms || {};
    let taxOverride = (p.taxOverride === 'TRUE' || p.taxOverride === 'FALSE') ? p.taxOverride : '';
    let bankOverride = (p.bankOverride === 'TRUE' || p.bankOverride === 'FALSE') ? p.bankOverride : '';
    if (!perms.canAccessTax) taxOverride = 'FALSE';
    if (!perms.canAccessBank) bankOverride = 'FALSE';

    let itemsForCalc = checkedItems.items;
    let totalDiscountPct = billDisc.value;
    if (!perms.canAccessDiscount || !settingOn_(settingsMap.ShowDiscountOption === undefined ? 'TRUE' : settingsMap.ShowDiscountOption)) {
      itemsForCalc = itemsForCalc.map(it => Object.assign({}, it, { discountPercent: 0 }));
      totalDiscountPct = 0;
    }
    const hsnIdx = productHsnIndex_();
    itemsForCalc = itemsForCalc.map(it => Object.assign({}, it, { hsn: hsnIdx[vLine_(it.name).toLowerCase()] || '' }));
    const totals = computeBillTotals_(itemsForCalc, totalDiscountPct, taxOverride, settingsMap);
    const totalQty = itemsForCalc.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const totalAmount = totals.netAmount; // pre-tax; tax is shown on top when switched on

    // 4. Bill ID
    const billsSh = ss_().getSheetByName(SHEET.BILLS);
    const billId = nextSequentialId_('bill', true);

    // 5. Cash / Bank only, collected at the counter.
    const paymentStatus = 'Cash Collected';

    // 6. Bill row (column order = BILLS_HEADERS)
    billsSh.appendRow([
      billId, date.value, customerId, cellSafe_(f.customerName), f.phone, cellSafe_(f.email), cellSafe_(f.address),
      cellSafe_(f.deliveryAddress), method.value, totalQty, totalAmount, paymentStatus,
      billerCheck.billerId, cellSafe_(String(billerCheck.billerName)), '', '', new Date(), new Date(), '', '',
      taxOverride, bankOverride, totals.totalDiscPct, cellSafe_(f.companyName || ''), f.customerGstin || ''
    ]);

    // 7. Line items - LineTotal is the DISCOUNTED total actually billed.
    appendBillItemRows_(billId, totals);

    // 7b. Deduct live stock for tracked products.
    applyStockChangeForItems_(itemsForCalc, billId, isAdminSession_() ? 'Super Admin' : 'Biller', billerCheck.billerName, billerCheck.billerId, -1);
    invalidateCache_('capacity');

    result = {
      ok: true, billId: billId, customerId: customerId, totalAmount: totalAmount,
      totalQty: totalQty, paymentStatus: paymentStatus,
      billerId: billerCheck.billerId, billerName: billerCheck.billerName,
      items: totals.items.map(it => ({ name: it.name, hsn: it.hsn || '' }))
    };
    if (saveToken) cache.put('save_' + saveToken, JSON.stringify(result), 1800);
  } finally {
    lock.releaseLock();
  }

  // 8. Refresh the spreadsheet-only report tabs AFTER the lock is released,
  // so another biller's Save never waits on them.
  refreshMirrorSheets_({ dashboard: true, universal: true, daily: true });
  return result;
}

function appendBillItemRows_(billId, totals) {
  if (!totals.items.length) return;
  const itemsSh = ss_().getSheetByName(SHEET.BILL_ITEMS);
  const rows = totals.items.map(it => [
    billId, cellSafe_(it.name), it.price, it.qty, it.lineTotal * (1 - totals.totalDiscPct / 100), it.discountPercent,
    it.hsn ? asText_(it.hsn) : ''
  ]);
  itemsSh.getRange(itemsSh.getLastRow() + 1, 1, rows.length, BILL_ITEMS_HEADERS.length).setValues(rows);
}

// ---------------------------------------------------------------------------
// 13. BILL LOOKUP
// ---------------------------------------------------------------------------
function apiGetBill(billId) {
  billId = String(billId || '').trim().toUpperCase();
  let billRow = null, foundDb = null;
  for (const db of allDbs_()) {
    const sh = db.ss.getSheetByName(SHEET.BILLS);
    if (!sh || sh.getLastRow() < 2) continue;
    // Find the row by its ID alone first (one column), then read just that row.
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]).toUpperCase() === billId) {
        billRow = sh.getRange(i + 2, 1, 1, Math.max(BILLS_HEADERS.length, sh.getLastColumn())).getValues()[0];
        foundDb = db;
        break;
      }
    }
    if (billRow) break;
  }
  if (!billRow) return { ok: false, error: 'Bill not found' };

  const itemsSh = foundDb.ss.getSheetByName(SHEET.BILL_ITEMS);
  const itemsData = itemsSh.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < itemsData.length; i++) {
    if (String(itemsData[i][0]).toUpperCase() === billId) {
      items.push({
        name: itemsData[i][1], price: itemsData[i][2], qty: itemsData[i][3], total: itemsData[i][4],
        discountPercent: Number(itemsData[i][5]) || 0, hsn: itemsData[i][6] == null ? '' : String(itemsData[i][6])
      });
    }
  }

  return {
    ok: true,
    bill: {
      billId: billRow[0], date: billRow[1], customerId: billRow[2], customerName: billRow[3],
      phone: billRow[4], email: billRow[5], address: billRow[6], deliveryAddress: billRow[7],
      paymentMethod: billRow[8], totalQty: billRow[9], totalAmount: billRow[10],
      paymentStatus: billRow[11], billerId: billRow[12], billerName: billRow[13],
      createdAt: billRow[16], updatedAt: billRow[17],
      updatedBy: billRow[18], versionNote: billRow[19],
      taxOverride: boolText_(billRow[20]), bankOverride: boolText_(billRow[21]),
      discountPercent: Number(billRow[22]) || 0,
      companyName: billRow[23] == null ? '' : String(billRow[23]),
      customerGstin: billRow[24] == null ? '' : String(billRow[24]),
      items: items,
      source: foundDb.label,
      editable: foundDb.label === 'Active'
    }
  };
}

// ---------------------------------------------------------------------------
// 14. EMAIL BILL - a branded email (white letterhead header with the full
//     logo, a thin red->orange accent line, the bill summary in the body,
//     and the address + social icons in the footer) PLUS the full invoice
//     attached as a PDF. The same builder powers apiGetEmailPreview, so the
//     preview is exactly what the customer receives. The first run after a
//     fresh deployment asks Google for a "send email" permission - accept it.
// ---------------------------------------------------------------------------
function apiEmailBillPdf(p) {
  const emailCheck = vEmail_(p.email, 'Email', true);
  if (emailCheck.error) return { ok: false, error: emailCheck.error, field: 'email' };
  const email = emailCheck.value;
  const res = apiGetBill(p.billId);
  if (!res.ok) return res;
  const bill = res.bill;
  const s = apiGetSettingsFull_();
  const totals = computeBillTotals_(bill.items, bill.discountPercent, bill.taxOverride, s);

  try {
    const pdfHtml = buildBillHtmlForPdf_(bill, s, totals);
    const pdfBlob = HtmlService.createHtmlOutput(pdfHtml).getAs('application/pdf').setName('Invoice-' + bill.billId + '.pdf');
    const emailHtml = buildBrandedEmailShell_(s, buildEmailBillBodyHtml_(bill, s, totals));
    MailApp.sendEmail({
      to: email,
      name: s.CompanyName || 'Kovai Lakshmi Grinders',
      replyTo: s.CompanyEmail || undefined,
      subject: 'Invoice ' + bill.billId + ' - ' + (s.CompanyName || 'Kovai Lakshmi Grinders'),
      htmlBody: emailHtml,
      attachments: [pdfBlob]
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Could not send email: ' + err.message };
  }
}

function apiGetEmailPreview(p) {
  const res = apiGetBill(p.billId);
  if (!res.ok) return res;
  const bill = res.bill;
  const s = apiGetSettingsFull_();
  const totals = computeBillTotals_(bill.items, bill.discountPercent, bill.taxOverride, s);
  return { ok: true, html: buildBrandedEmailShell_(s, buildEmailBillBodyHtml_(bill, s, totals)) };
}

// Email BODY - greeting + a clean bill summary table. Plain HTML tables
// with inline styles only (Outlook and Gmail need that).
function buildEmailBillBodyHtml_(bill, s, totals) {
  const tax = totals.tax;
  const ink = '#1F1B1B';
  const border = '#EBDFDB';
  const font = "font-family:Georgia,'Times New Roman',Times,serif;";
  const hasAnyItemDiscount = totals.itemDiscountTotal > 0.004;
  const cell = 'padding:12px 10px;' + font + 'font-size:14px;line-height:22px;color:' + ink + ';';

  const rows = totals.items.map(function (i) {
    const discCell = i.discountPercent > 0 ? '-' + i.discountPercent + '%' : '&ndash;';
    return '<tr>' +
      '<td style="' + cell + 'border-bottom:1px solid ' + border + ';">' + escHtml_(i.name) + '</td>' +
      '<td align="center" style="' + cell + 'border-bottom:1px solid ' + border + ';">' + i.qty + '</td>' +
      '<td align="center" style="' + cell + 'border-bottom:1px solid ' + border + ';">' + discCell + '</td>' +
      '<td align="right" style="' + cell + 'border-bottom:1px solid ' + border + ';font-weight:700;">₹' + money_(i.lineTotal) + '</td>' +
      '</tr>';
  }).join('');

  const totalRow_ = function (label, value, isGrand) {
    const top = isGrand ? 'border-top:2px solid #EB343A;' : '';
    return '<tr>' +
      '<td colspan="3" align="right" style="' + cell + 'font-weight:' + (isGrand ? '800' : '600') + ';' + top + '">' + label + '</td>' +
      '<td align="right" style="' + cell + 'font-weight:800;' + top + (isGrand ? 'color:#D42A30;' : '') + '">' + value + '</td>' +
      '</tr>';
  };
  let totalsRows = totalRow_('Item Subtotal', '₹' + money_(totals.grossSubtotal));
  if (hasAnyItemDiscount) totalsRows += totalRow_('Item Discounts', '-₹' + money_(totals.itemDiscountTotal));
  if (totals.totalDiscPct > 0) totalsRows += totalRow_('Additional Discount (' + totals.totalDiscPct + '%)', '-₹' + money_(totals.totalDiscountAmount));
  if (tax.showTaxSection) totalsRows += totalRow_('Tax', '₹' + money_(tax.taxTotal));
  totalsRows += totalRow_('Grand Total', '₹' + money_(tax.grandTotal), true);

  const head = 'padding:12px 10px;' + font + 'font-size:12.5px;line-height:20px;text-transform:uppercase;letter-spacing:.3px;color:#ffffff;background-color:#D42A30;';
  const words = s.ShowAmountInWords !== false
    ? '<tr><td style="' + font + 'font-size:13px;line-height:20px;color:#5A5150;font-style:italic;padding:0 0 22px;">' + escHtml_(amountInWordsIN_(tax.grandTotal)) + '</td></tr>'
    : '';

  return '' +
    '<tr><td align="left" style="' + font + 'font-size:15px;line-height:24px;color:' + ink + ';padding-bottom:22px;">' +
    '<b>Dear ' + escHtml_(bill.customerName || 'Customer') + ',</b><br><br>' +
    'Thank you for your purchase from ' + escHtml_(s.CompanyName || 'us') + '. Here’s a summary of Invoice <b>' + escHtml_(String(bill.billId)) + '</b>, dated ' + escHtml_(formatDate_(bill.date)) + '. The full invoice is attached to this email as a PDF.' +
    '</td></tr>' +
    '<tr><td style="padding-bottom:14px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + border + ';border-collapse:collapse;">' +
    '<tr>' +
    '<td style="' + head + '">Product</td>' +
    '<td align="center" style="' + head + '">Qty</td>' +
    '<td align="center" style="' + head + '">Discount</td>' +
    '<td align="right" style="' + head + '">Total</td>' +
    '</tr>' +
    rows +
    totalsRows +
    '</table>' +
    '</td></tr>' +
    words +
    '<tr><td align="left" style="' + font + 'font-size:14px;line-height:22px;color:' + ink + ';">' +
    'Questions about this invoice? Just reply to this email' + (s.Phone ? ' or call us at <b>' + escHtml_(prettyPhone_(s.Phone)) + '</b>' : '') + '.<br><br>' +
    'Warm regards,<br><b>Team ' + escHtml_(s.CompanyName || '') + '</b>' +
    '</td></tr>';
}

// The branded shell every invoice email uses, following the shop's
// letterhead: white header with the full logo, a thin brand accent line,
// the body, another accent line, then a white footer with the address,
// "Connect With Us" and the social icons. Table-based markup + inline
// styles + a <=600px media query, so it renders in Gmail, Outlook and phones.
function buildBrandedEmailShell_(s, bodyRowsHtml) {
  const font = "Georgia, 'Times New Roman', Times, serif";
  const logo = s.LetterheadLogoURL || (ASSET_BASE + 'FULL-LOGO.png');
  const companyName = escHtml_(s.CompanyName || '');
  const accent = '<tr><td style="padding:0;height:4px;line-height:4px;font-size:0;background-color:#EB343A;' +
    'background-image:linear-gradient(90deg,#EB343A 0%,#F48F33 100%);" bgcolor="#EB343A">&nbsp;</td></tr>';

  // Icons in the same order as the letterpad footer. Phone and email come
  // from Shop Details; the rest from the Social Links fields.
  const socialDefs = socialLinks_(s);
  const socialHtml = socialDefs.length
    ? '<tr><td align="center" style="padding:0 0 18px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      socialDefs.map(function (d) {
        return '<td style="padding:0 7px;"><a href="' + escHtml_(d.href) + '" target="_blank" style="text-decoration:none;"><img src="' + ASSET_BASE + d.icon + '" width="30" height="30" alt="' + d.alt + '" style="display:block;width:30px;height:30px;border:0;"></a></td>';
      }).join('') +
      '</tr></table></td></tr>'
    : '';

  return '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<style>' +
    'html,body{margin:0!important;padding:0!important;height:100%!important;width:100%!important;}' +
    '*{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;}' +
    'table,td{mso-table-lspace:0pt!important;mso-table-rspace:0pt!important;border-collapse:collapse!important;}' +
    'img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;}' +
    'a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}' +
    'body{font-family:' + font + ';}' +
    '@media only screen and (max-width:600px){' +
    '.eml-pad{padding-left:20px!important;padding-right:20px!important;}' +
    '.eml-logo{width:300px!important;}' +
    '.eml-table td{font-size:13px!important;padding:10px 6px!important;}' +
    '}' +
    '</style></head>' +
    '<body style="margin:0;padding:0;background-color:#F4EFEC;width:100%;" bgcolor="#F4EFEC">' +
    '<center style="width:100%;background-color:#F4EFEC;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#F4EFEC;"><tr><td align="center" style="padding:18px 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;">' +

    // Header - white letterhead with the full logo.
    '<tr><td align="center" class="eml-pad" style="padding:28px 36px 22px;background-color:#ffffff;">' +
    '<img src="' + escHtml_(logo) + '" class="eml-logo" width="420" alt="' + companyName + '" style="display:block;width:420px;max-width:90%;height:auto;margin:0 auto;border:0;">' +
    '</td></tr>' +
    accent +

    // Body
    '<tr><td style="padding:0;background-color:#ffffff;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td align="center" class="eml-pad" style="padding:38px 44px 30px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="eml-table">' +
    bodyRowsHtml +
    '</table></td></tr></table></td></tr>' +

    // Footer - address, "Connect With Us", icons.
    accent +
    '<tr><td align="center" class="eml-pad" style="padding:24px 36px 6px;background-color:#ffffff;font-family:' + font + ';font-size:14px;line-height:22px;color:#1F1B1B;">' +
    '<b>' + companyName + '</b>' + (s.Address ? ' - ' + escHtml_(String(s.Address).replace(/\n+/g, ', ')) : '') +
    '</td></tr>' +
    (socialHtml ? '<tr><td align="center" style="padding:12px 0 12px;font-family:' + font + ';font-size:13px;font-weight:700;color:#1F1B1B;letter-spacing:.3px;">Connect With Us</td></tr>' + socialHtml : '') +
    '<tr><td align="center" style="padding:0 0 22px;font-family:' + font + ';font-size:11.5px;color:#7A706E;">&copy; ' + new Date().getFullYear() + ' ' + companyName + '. All Rights Reserved.</td></tr>' +

    '</table></td></tr></table></center></body></html>';
}

// Shared by the email footer (links) - same order as the letterpad footer.
function socialLinks_(s) {
  return [
    s.Phone ? { icon: 'PHONE.png', href: 'tel:+91' + String(s.Phone).replace(/[^0-9]/g, '').slice(-10), alt: 'Phone' } : null,
    s.SocialWhatsApp ? { icon: 'WA.png', href: 'https://wa.me/' + waNumber_(s.SocialWhatsApp), alt: 'WhatsApp' } : null,
    s.CompanyEmail ? { icon: 'MAIL.png', href: 'mailto:' + s.CompanyEmail, alt: 'Email' } : null,
    s.SocialInstagram ? { icon: 'INSTA.png', href: s.SocialInstagram, alt: 'Instagram' } : null,
    s.SocialFacebook ? { icon: 'FACEBOOK.png', href: s.SocialFacebook, alt: 'Facebook' } : null,
    s.SocialLinkedIn ? { icon: 'LINKEDIN.png', href: s.SocialLinkedIn, alt: 'LinkedIn' } : null,
    s.SocialYouTube ? { icon: 'YOUTUBE.png', href: s.SocialYouTube, alt: 'YouTube' } : null,
    s.Website ? { icon: 'WEBSITE.png', href: /^https?:\/\//i.test(String(s.Website)) ? String(s.Website) : 'https://' + String(s.Website).replace(/^\/+/, ''), alt: 'Website' } : null
  ].filter(Boolean);
}

// Tax is OFF by default for every bill - only switched on per bill.
function computeTax_(subTotal, s, taxOverride) {
  const cgstPct = Number(s.CGSTPercent) || 0;
  const sgstPct = Number(s.SGSTPercent) || 0;
  const showTax = taxOverride === 'TRUE';
  const cgst = cgstPct > 0 ? Math.round(subTotal * cgstPct) / 100 : 0;
  const sgst = sgstPct > 0 ? Math.round(subTotal * sgstPct) / 100 : 0;
  const taxTotal = cgst + sgst;
  const showTaxSection = showTax && (cgstPct > 0 || sgstPct > 0);
  return {
    cgstPct: cgstPct > 0 ? cgstPct : 0,
    sgstPct: sgstPct > 0 ? sgstPct : 0,
    cgstAmount: cgst, sgstAmount: sgst, taxTotal,
    grandTotal: subTotal + (showTaxSection ? taxTotal : 0),
    showTaxSection
  };
}

// Single source of truth for a bill's numbers - used at save, at edit, and
// for the emailed PDF. Order: each item's own discount %, THEN the
// bill-level "additional discount" %, THEN tax (if switched on).
function computeBillTotals_(items, totalDiscountPct, taxOverride, s) {
  let grossSubtotal = 0, itemDiscountTotal = 0;
  const lineDetails = (items || []).map(function (it) {
    const price = Number(it.price) || 0;
    const qty = Number(it.qty) || 0;
    const discPct = Math.min(100, Math.max(0, Number(it.discountPercent != null ? it.discountPercent : it.discountPct) || 0));
    const gross = price * qty;
    const lineDiscountAmount = gross * discPct / 100;
    const lineTotal = gross - lineDiscountAmount;
    grossSubtotal += gross;
    itemDiscountTotal += lineDiscountAmount;
    return { name: it.name, price: price, qty: qty, discountPercent: discPct, gross: gross, lineTotal: lineTotal, hsn: it.hsn ? String(it.hsn) : '' };
  });
  const afterItemDiscount = grossSubtotal - itemDiscountTotal;
  const totalDiscPct = Math.min(100, Math.max(0, Number(totalDiscountPct) || 0));
  const totalDiscountAmount = afterItemDiscount * totalDiscPct / 100;
  const netAmount = afterItemDiscount - totalDiscountAmount;
  const tax = computeTax_(netAmount, s, taxOverride);
  return {
    items: lineDetails,
    grossSubtotal: grossSubtotal,
    itemDiscountTotal: itemDiscountTotal,
    afterItemDiscount: afterItemDiscount,
    totalDiscPct: totalDiscPct,
    totalDiscountAmount: totalDiscountAmount,
    netAmount: netAmount,
    tax: tax,
    grandTotal: tax.grandTotal
  };
}

// ---- Amount in words, Indian system (lakh / crore) ------------------------
const IN_ONES_ = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const IN_TENS_ = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function inWordsBelow100_(n) { return n < 20 ? IN_ONES_[n] : IN_TENS_[Math.floor(n / 10)] + (n % 10 ? ' ' + IN_ONES_[n % 10] : ''); }
function inWordsBelow1000_(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return (h ? IN_ONES_[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? inWordsBelow100_(r) : '');
}
function intToWordsIN_(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(intToWordsIN_(crore) + ' Crore');
  if (lakh) parts.push(inWordsBelow100_(lakh) + ' Lakh');
  if (thousand) parts.push(inWordsBelow100_(thousand) + ' Thousand');
  if (n) parts.push(inWordsBelow1000_(n));
  return parts.join(' ');
}
// 112050.5 -> "Rupees One Lakh Twelve Thousand Fifty and Fifty Paise Only"
function amountInWordsIN_(amount) {
  const paiseTotal = Math.round((Number(amount) || 0) * 100);
  const rupees = Math.floor(paiseTotal / 100), paise = paiseTotal % 100;
  let out = 'Rupees ' + intToWordsIN_(rupees);
  if (paise) out += ' and ' + inWordsBelow100_(paise) + ' Paise';
  return out + ' Only';
}

function money_(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function prettyPhone_(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? '+91 ' + d.slice(0, 5) + ' ' + d.slice(5) : String(p || '');
}

// Logos are fetched once and kept (as data) for 6 hours, so emailing a bill
// doesn't download the logo every single time.
function getLogoDataUri_(url) {
  if (!url) return '';
  const key = 'logo_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url));
  const c = CacheService.getScriptCache();
  const hit = c.get(key);
  if (hit) return hit;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return '';
    const blob = resp.getBlob();
    const uri = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    if (uri.length < 95000) c.put(key, uri, 21600);
    return uri;
  } catch (err) {
    return '';
  }
}

// The emailed PDF - a one-to-one mirror of the on-screen bill (app.js
// buildCompanyHeadHtml / buildCustomerMetaHtml / buildBillItemsTableHtml /
// buildBillTotalsAndFooterHtml + style.css), so it never looks different.
function buildBillHtmlForPdf_(bill, s, totals) {
  const tax = totals.tax;
  const hasAnyItemDiscount = totals.itemDiscountTotal > 0.004;
  const showHsn = s.ShowHSNOnBill === true;
  const rows = totals.items.map(function (i, k) {
    const discCell = hasAnyItemDiscount ? '<td class="num disc">' + (i.discountPercent > 0 ? '-' + i.discountPercent + '%' : '-') + '</td>' : '';
    return '<tr><td class="sn">' + (k + 1) + '</td><td>' + escHtml_(i.name) + '</td>' +
      (showHsn ? '<td>' + escHtml_(i.hsn || '-') + '</td>' : '') +
      '<td class="num">₹' + money_(i.price) + '</td><td class="num">' + i.qty + '</td>' + discCell +
      '<td class="num">₹' + money_(i.lineTotal) + '</td></tr>';
  }).join('');
  const tableHead = '<tr><th class="sn">#</th><th>Product</th>' + (showHsn ? '<th>HSN</th>' : '') +
    '<th class="num">Price</th><th class="num">Qty</th>' +
    (hasAnyItemDiscount ? '<th class="num">Discount</th>' : '') + '<th class="num">Total</th></tr>';

  let totalsRows = '<div class="row"><span>Total Qty</span><span>' + bill.totalQty + '</span></div>';
  totalsRows += '<div class="row"><span>Item Subtotal</span><span>₹' + money_(totals.grossSubtotal) + '</span></div>';
  if (hasAnyItemDiscount) totalsRows += '<div class="row disc"><span>Item Discounts</span><span>-₹' + money_(totals.itemDiscountTotal) + '</span></div>';
  if (totals.totalDiscPct > 0) totalsRows += '<div class="row disc"><span>Additional Discount (' + totals.totalDiscPct + '%)</span><span>-₹' + money_(totals.totalDiscountAmount) + '</span></div>';
  if (hasAnyItemDiscount || totals.totalDiscPct > 0) totalsRows += '<div class="row"><span>Net Amount</span><span>₹' + money_(totals.netAmount) + '</span></div>';
  if (tax.showTaxSection) {
    if (tax.cgstPct > 0) totalsRows += '<div class="row"><span>CGST @ ' + tax.cgstPct + '%</span><span>₹' + money_(tax.cgstAmount) + '</span></div>';
    if (tax.sgstPct > 0) totalsRows += '<div class="row"><span>SGST @ ' + tax.sgstPct + '%</span><span>₹' + money_(tax.sgstAmount) + '</span></div>';
    totalsRows += '<div class="row"><span>Tax Total</span><span>₹' + money_(tax.taxTotal) + '</span></div>';
  }
  totalsRows += '<div class="row grand"><span>Grand Total</span><span>₹' + money_(tax.grandTotal) + '</span></div>';
  const wordsHtml = s.ShowAmountInWords !== false ? '<div class="bill-words">Amount in words: <b>' + escHtml_(amountInWordsIN_(tax.grandTotal)) + '</b></div>' : '';

  const logo = getLogoDataUri_(s.PrintLogoURL || s.LogoURL || '');
  const metaLines = [];
  if (s.Address) metaLines.push(escHtml_(s.Address).replace(/\n/g, '<br>'));
  const contactBits = [];
  if (s.Phone) contactBits.push(escHtml_(prettyPhone_(s.Phone)));
  if (s.ShowCompanyEmail !== false && s.CompanyEmail) contactBits.push(escHtml_(s.CompanyEmail));
  if (contactBits.length) metaLines.push(contactBits.join(' | '));
  if (s.Website) metaLines.push(escHtml_(s.Website));
  if (s.GSTNumber) metaLines.push('GSTIN: ' + escHtml_(s.GSTNumber));

  const leftMeta = [
    'Date: <b>' + escHtml_(formatDate_(bill.date)) + '</b>',
    'Customer: <b>' + escHtml_(bill.customerName || '') + '</b>'
  ];
  if (bill.companyName) leftMeta.push('Company: <b>' + escHtml_(bill.companyName) + '</b>');
  if (bill.customerGstin) leftMeta.push('Customer GSTIN: <b>' + escHtml_(bill.customerGstin) + '</b>');
  leftMeta.push('Customer ID: <b>' + escHtml_(bill.customerId || '') + '</b>');
  leftMeta.push('Phone: <b>' + escHtml_(bill.phone || '') + '</b>');
  if (bill.email) leftMeta.push('Email: <b>' + escHtml_(bill.email) + '</b>');

  const rightMeta = ['Payment Method: <b>' + escHtml_(paymentMethodLabel_(bill.paymentMethod)) + '</b>'];
  if (bill.address) rightMeta.push('Billing Address: <b>' + escHtml_(bill.address) + '</b>');
  if (bill.deliveryAddress) rightMeta.push('Delivery Address: <b>' + escHtml_(bill.deliveryAddress) + '</b>');

  let bankHtml = '';
  const showBank = (bill.bankOverride === 'TRUE' || bill.bankOverride === 'FALSE') ? (bill.bankOverride === 'TRUE') : (s.ShowBankDetails !== false);
  if (showBank) {
    const parts = [];
    if (s.BankName) parts.push('Bank: <b>' + escHtml_(s.BankName) + '</b>');
    if (s.BankAccountNo) parts.push('A/c: <b>' + escHtml_(s.BankAccountNo) + '</b>');
    if (s.BankIFSC) parts.push('IFSC: <b>' + escHtml_(s.BankIFSC) + '</b>');
    if (s.BankAccountHolder) parts.push('Holder: <b>' + escHtml_(s.BankAccountHolder) + '</b>');
    if (parts.length) bankHtml = '<div class="bill-bank">' + parts.join(' &nbsp;&middot;&nbsp; ') + '</div>';
  }

  let signHtml = '';
  if (s.ShowAuthorizedSignatory !== false) {
    const label = s.AuthorizedSignatoryLabel || 'Authorized Signatory';
    signHtml = '<div class="bill-sign"><div class="sign-for">For ' + escHtml_(s.CompanyName || '') + '</div><div class="sign-box"></div><div class="sign-label">' + escHtml_(label) + '</div></div>';
  }
  let termsHtml = '';
  if (s.ShowTerms === true && String(s.TermsText || '').trim()) {
    const lines = String(s.TermsText).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    termsHtml = '<div class="bill-terms"><div class="bill-terms-title">Terms &amp; Conditions</div><ol>' +
      lines.map(function (l) { return '<li>' + escHtml_(l) + '</li>'; }).join('') + '</ol></div>';
  }

  const themeBillHeader = s.ThemeBillHeaderColor || '#D42A30';
  const themeHeading = s.ThemeHeadingColor || '#1F1B1B';
  const themeMuted = s.ThemeMutedColor || '#5A5150';
  const themeBorder = s.ThemeBorderColor || '#EBDFDB';
  const themeDiscount = s.ThemeBillDiscountColor || '#B23A2E';
  const billFont = s.ThemeBillFontFamily || "Georgia, 'Times New Roman', Times, serif";
  const logoW = Math.max(20, Number(s.ThemeBillLogoWidth) || 130);
  const logoH = Math.max(20, Number(s.ThemeBillLogoHeight) || 56);

  const isOn_ = function (v) { return String(v == null ? '' : v).trim().toUpperCase() === 'TRUE'; };
  const nameWeight = isOn_(s.ThemeBillCompanyNameBold === undefined ? 'TRUE' : s.ThemeBillCompanyNameBold) ? '800' : '400';
  const nameStyle = isOn_(s.ThemeBillCompanyNameItalic) ? 'italic' : 'normal';
  const nameDecoration = isOn_(s.ThemeBillCompanyNameUnderline) ? 'underline' : 'none';
  const infoWeight = isOn_(s.ThemeBillCompanyInfoBold) ? '700' : '400';
  const infoStyle = isOn_(s.ThemeBillCompanyInfoItalic) ? 'italic' : 'normal';
  const infoDecoration = isOn_(s.ThemeBillCompanyInfoUnderline) ? 'underline' : 'none';
  const headerLayout = s.ThemeBillHeaderLayout === 'logo-top' ? 'logo-top' : 'logo-side';
  const tagHtml = '<div class="bill-tag"><div class="bill-tag-label">Invoice</div><div class="big">' + escHtml_(String(bill.billId)) + '</div></div>';
  const infoHtml = '<div class="bill-head-info"><p class="co-name">' + escHtml_(s.CompanyName || 'Invoice') + '</p><div class="co-meta">' + metaLines.join('<br>') + '</div></div>';
  const headHtml = headerLayout === 'logo-top'
    ? '<div class="bill-head bill-head-stacked"><div class="bill-head-top">' +
      (logo ? '<img class="bill-logo" src="' + logo + '">' : '<span></span>') + tagHtml + '</div>' + infoHtml + '</div>'
    : '<div class="bill-head">' + (logo ? '<img class="bill-logo" src="' + logo + '">' : '') + infoHtml + tagHtml + '</div>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=750"><style>' +
    // A fixed pixel width - Apps Script's HTML-to-PDF conversion has no
    // dependable page width for percentages to resolve against.
    'html,body{width:750px;margin:0;padding:0;}' +
    'body{font-family:' + billFont + ';color:' + themeHeading + ';background:#FFFFFE;}' +
    '.bill-page{width:100%;box-sizing:border-box;padding:24px 26px;font-size:13px;}' +
    '.bill-accent{height:4px;background:#EB343A;background-image:linear-gradient(90deg,#EB343A 0%,#F48F33 100%);margin:0 0 14px;}' +
    '.bill-head{display:flex;gap:12px;align-items:flex-start;border-bottom:1.5px solid ' + themeHeading + ';padding-bottom:8px;}' +
    '.bill-head-stacked{display:block;}' +
    '.bill-head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}' +
    '.bill-logo{width:' + logoW + 'px;height:' + logoH + 'px;max-width:' + logoW + 'px;max-height:' + logoH + 'px;object-fit:contain;background:#fff;flex-shrink:0;}' +
    '.bill-head-info{flex:1;min-width:0;}' +
    '.co-name{font-size:18px;font-weight:' + nameWeight + ';font-style:' + nameStyle + ';text-decoration:' + nameDecoration + ';margin:0 0 4px;color:' + themeBillHeader + ';}' +
    '.co-meta{font-size:11px;font-weight:' + infoWeight + ';font-style:' + infoStyle + ';text-decoration:' + infoDecoration + ';color:' + themeHeading + ';line-height:1.55;margin:0;}' +
    '.bill-tag{margin-left:auto;text-align:right;flex-shrink:0;}' +
    '.bill-tag-label{font-size:10px;color:' + themeMuted + ';text-transform:uppercase;letter-spacing:.3px;}' +
    '.bill-tag .big{font-size:19px;font-weight:800;letter-spacing:.5px;color:' + themeBillHeader + ';}' +
    '.bill-meta-grid{display:flex;justify-content:space-between;gap:8px 28px;font-size:12px;margin:14px 0;color:' + themeMuted + ';}' +
    '.bill-meta-col{display:flex;flex-direction:column;gap:3px;}' +
    '.bill-meta-col b{color:' + themeHeading + ';}' +
    '.bill-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px;}' +
    '.bill-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;border-bottom:1.5px solid ' + themeHeading + ';padding:6px 4px;color:' + themeMuted + ';}' +
    '.bill-table td{padding:7px 4px;border-bottom:1px solid ' + themeBorder + ';}' +
    '.bill-table td.num,.bill-table th.num{text-align:right;}' +
    '.bill-table .sn{width:22px;color:' + themeMuted + ';}' +
    '.bill-table td.disc{color:' + themeDiscount + ';font-size:11.5px;}' +
    '.bill-totals{margin-top:10px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;}' +
    '.bill-totals .row{display:flex;gap:24px;font-size:13px;width:260px;justify-content:space-between;}' +
    '.bill-totals .row.disc{color:' + themeDiscount + ';font-size:12px;}' +
    '.bill-totals .grand{font-size:16px;font-weight:800;border-top:2px solid ' + themeHeading + ';padding-top:6px;margin-top:4px;}' +
    '.bill-words{margin-top:8px;font-size:11.5px;color:' + themeMuted + ';text-align:right;}' +
    '.bill-words b{color:' + themeHeading + ';font-weight:700;}' +
    '.bill-terms{margin-top:14px;font-size:10.5px;color:' + themeMuted + ';border:1px solid ' + themeBorder + ';border-radius:4px;padding:8px 10px;}' +
    '.bill-terms-title{font-weight:700;color:' + themeHeading + ';text-transform:uppercase;letter-spacing:.3px;font-size:10px;margin-bottom:3px;}' +
    '.bill-terms ol{margin:0;padding-left:16px;}' +
    '.bill-foot{margin-top:18px;font-size:11px;color:' + themeMuted + ';border-top:1px dashed ' + themeBorder + ';padding-top:12px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;}' +
    '.bill-foot-main{flex:1;min-width:0;}' +
    '.bill-bank{margin-top:8px;font-size:10.5px;line-height:1.55;color:' + themeMuted + ';}' +
    '.bill-sign{text-align:center;flex-shrink:0;min-width:140px;}' +
    '.sign-for{font-size:10px;color:' + themeHeading + ';font-weight:700;margin-bottom:4px;}' +
    '.sign-box{width:130px;height:42px;border:1px solid ' + themeBorder + ';border-radius:4px;margin:0 auto 4px;background:#fafafa;}' +
    '.sign-label{font-size:10px;color:' + themeMuted + ';text-transform:uppercase;letter-spacing:.3px;}' +
    '</style></head><body><div class="bill-page">' +
    '<div class="bill-accent"></div>' +
    headHtml +
    '<div class="bill-meta-grid">' +
    '<div class="bill-meta-col">' + leftMeta.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' +
    '<div class="bill-meta-col">' + rightMeta.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' +
    '</div>' +
    '<table class="bill-table"><thead>' + tableHead + '</thead><tbody>' + rows + '</tbody></table>' +
    '<div class="bill-totals">' + totalsRows + '</div>' +
    wordsHtml +
    termsHtml +
    '<div class="bill-foot">' +
    '<div class="bill-foot-main">Billed by: <b>' + escHtml_(bill.billerName || '') + '</b><br>' +
    'Thank you for your business with ' + escHtml_(s.CompanyName || 'us') + '!' + bankHtml + '</div>' +
    signHtml +
    '</div>' +
    '</div></body></html>';
}

function formatDate_(val) {
  if (!val) return '-';
  const d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return day + '-' + m + '-' + y;
}

function paymentMethodLabel_(method) {
  if (method === 'Cash') return 'Cash in Hand';
  if (method === 'Bank') return 'Bank Transaction';
  return method || '-';
}

function waNumber_(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length === 10 ? '91' + d : d;
}

function escHtml_(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 15. EDIT A SAVED BILL (Find / Edit Bill)
//     Super Admin may edit any bill in the active database; a biller needs
//     the Find/Edit switch. The logged-in session decides - no password is
//     asked again. A reason for the change is always required.
// ---------------------------------------------------------------------------
function authorizeBillEdit_() {
  if (isAdminSession_()) {
    return {
      ok: true, updatedByLabel: 'Super Admin',
      performerRole: 'Super Admin', performerName: 'Super Admin', performerId: '',
      canAccessTax: true, canAccessBank: true, canAccessDiscount: true
    };
  }
  const b = findBillerRow_(SESSION_.billerId);
  if (!b || !b.active) return { ok: false, error: 'This biller ID is deactivated' };
  if (!b.perms.canAccessFindEdit) return { ok: false, error: 'You do not have Find/Edit access. Ask the Super Admin to switch it on.' };
  return {
    ok: true, updatedByLabel: 'Biller: ' + b.name + ' (' + b.id + ')',
    performerRole: 'Biller', performerName: b.name, performerId: b.id,
    canAccessTax: b.perms.canAccessTax, canAccessBank: b.perms.canAccessBank, canAccessDiscount: b.perms.canAccessDiscount
  };
}

function apiUpdateBill(p) {
  const auth = authorizeBillEdit_();
  if (!auth.ok) return auth;

  const note = vFreeText_(p.versionNote, 'Reason For Change', VLIMIT.NOTE_MAX, true, 3);
  if (note.error) {
    return { ok: false, field: 'versionNote', error: !vLine_(p.versionNote) ? 'Please enter a reason for this change before saving.' : note.error };
  }

  let mirrorsNeeded = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(SHEET.BILLS);
    const data = sh.getDataRange().getValues();
    let rowIdx = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(p.billId)) { rowIdx = i + 1; break; }
    }
    if (rowIdx === -1) {
      for (const db of openArchives_()) {
        const archiveSh = db.ss.getSheetByName(SHEET.BILLS);
        if (!archiveSh) continue;
        const archiveData = archiveSh.getDataRange().getValues();
        for (let i = 1; i < archiveData.length; i++) {
          if (String(archiveData[i][0]) === String(p.billId)) {
            return { ok: false, error: 'This invoice is in "' + db.label + '" (archived) and is read-only - archived invoices can\'t be edited, the same way a closed financial year\'s books normally aren\'t.' };
          }
        }
      }
      return { ok: false, error: 'Bill not found' };
    }
    const original = data[rowIdx - 1].slice();
    while (original.length < BILLS_HEADERS.length) original.push('');
    const row = original.slice();
    const f = p.fields || {};

    // ---- 1. Validate EVERYTHING before writing ANYTHING. Only fields that
    // actually changed are checked against the rules.
    const changed = function (k, col) {
      return f[k] !== undefined && vLine_(f[k]) !== vLine_(row[col]);
    };
    const fieldRules = [
      ['customerName', 3, function (v) { return vPersonName_(v, 'Customer Name', true); }],
      ['phone', 4, function (v) { return vMobile_(v, 'Phone Number', true); }],
      ['email', 5, function (v) { return vEmail_(v, 'Email', false); }],
      ['address', 6, function (v) { return vAddress_(v, 'Address'); }],
      ['deliveryAddress', 7, function (v) { return vAddress_(v, 'Delivery Address'); }],
      ['paymentMethod', 8, function (v) { return vOneOf_(v, 'Payment Method', PAYMENT_METHODS); }],
      ['paymentStatus', 11, function (v) { return vOneOf_(v, 'Payment Status', PAYMENT_STATUSES); }],
      ['companyName', 23, function (v) { return vOrgName_(v, 'Company Name', 80); }],
      ['customerGstin', 24, function (v) { return vGstin_(v, 'Customer GSTIN'); }]
    ];
    for (let k = 0; k < fieldRules.length; k++) {
      const key = fieldRules[k][0], col = fieldRules[k][1];
      if (!changed(key, col)) continue;
      if (key === 'phone' && normalizeMobile_(f.phone) === normalizeMobile_(row[col])) continue;
      const r = fieldRules[k][2](f[key]);
      if (r.error) return { ok: false, error: r.error, field: key };
      row[col] = r.value;
    }

    let totalDiscountPct = Number(row[22]) || 0;
    if (f.discountPercent !== undefined) {
      const d = vPercent_(f.discountPercent, 'Additional Discount %');
      if (d.error) return { ok: false, error: d.error, field: 'discountPercent' };
      totalDiscountPct = d.value;
    }

    const itemsSh = ss_().getSheetByName(SHEET.BILL_ITEMS);
    const itemsData = itemsSh.getDataRange().getValues();
    const oldItems = [];
    const oldRows = [];
    const known = productNameIndex_();
    const oldHsn = {};
    for (let i = 1; i < itemsData.length; i++) {
      if (String(itemsData[i][0]) === String(p.billId)) {
        oldItems.push({ name: itemsData[i][1], price: itemsData[i][2], qty: itemsData[i][3], discountPercent: Number(itemsData[i][5]) || 0, hsn: itemsData[i][6] == null ? '' : String(itemsData[i][6]) });
        oldRows.push(i + 1);
        known[vLine_(itemsData[i][1]).toLowerCase()] = true;
        oldHsn[vLine_(itemsData[i][1]).toLowerCase()] = itemsData[i][6] == null ? '' : String(itemsData[i][6]);
      }
    }
    let newItems = null;
    if (f.items) {
      const checked = vItems_(f.items, known);
      if (checked.error) return { ok: false, error: checked.error, field: 'items' };
      const hsnIdx = productHsnIndex_();
      newItems = checked.items.map(it => {
        const k = vLine_(it.name).toLowerCase();
        return Object.assign({}, it, { hsn: hsnIdx[k] || oldHsn[k] || '' });
      });
    }

    // ---- 2. Tax / bank / discount recomputed here from scratch.
    let taxOverride = boolText_(row[20]);
    let bankOverride = boolText_(row[21]);
    if (f.taxOverride === 'TRUE' || f.taxOverride === 'FALSE') taxOverride = f.taxOverride;
    if (f.bankOverride === 'TRUE' || f.bankOverride === 'FALSE') bankOverride = f.bankOverride;
    if (!auth.canAccessTax) taxOverride = 'FALSE';
    if (!auth.canAccessBank) bankOverride = 'FALSE';
    if (!auth.canAccessDiscount) totalDiscountPct = 0;
    if (newItems && !auth.canAccessDiscount) newItems = newItems.map(it => Object.assign({}, it, { discountPercent: 0 }));

    const settingsMap = getSettingsMap_();
    const itemsForTotals = newItems || oldItems;
    const totals = computeBillTotals_(itemsForTotals, totalDiscountPct, taxOverride, settingsMap);
    const totalQty = itemsForTotals.reduce((s, it) => s + (Number(it.qty) || 0), 0);

    // ---- 3. Write - the whole bill row in ONE call.
    const now = new Date();
    row[9] = totalQty;
    row[10] = totals.netAmount;
    row[17] = now;
    row[18] = auth.updatedByLabel;
    row[19] = 'Updated by ' + auth.updatedByLabel + ' on ' +
      Utilities.formatDate(now, 'Asia/Kolkata', 'd/M/yyyy, h:mm:ss a') + ' IST - ' + note.value;
    row[20] = taxOverride;
    row[21] = bankOverride;
    row[22] = totals.totalDiscPct;
    sh.getRange(rowIdx, 1, 1, row.length).setValues([row.map((v, k) => v === original[k] ? keepType_(v) : cellSafe_(v))]);

    if (newItems) {
      for (let j = oldRows.length - 1; j >= 0;) {
        let start = oldRows[j], count = 1;
        while (j - count >= 0 && oldRows[j - count] === start - 1) { start--; count++; }
        itemsSh.deleteRows(start, count);
        j -= count;
      }
      appendBillItemRows_(p.billId, totals);
      // Give back what the old lines held, then deduct the new lines.
      applyStockChangeForItems_(oldItems, p.billId, auth.performerRole, auth.performerName, auth.performerId, +1);
      applyStockChangeForItems_(newItems, p.billId, auth.performerRole, auth.performerName, auth.performerId, -1);
    }
    mirrorsNeeded = true;
  } finally {
    lock.releaseLock();
  }

  if (mirrorsNeeded) refreshMirrorSheets_({ dashboard: true, universal: true, daily: true });
  return { ok: true };
}

// Sheets turns the text "TRUE"/"FALSE" into real booleans when written.
function boolText_(v) {
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  const t = String(v == null ? '' : v).trim().toUpperCase();
  return (t === 'TRUE' || t === 'FALSE') ? t : '';
}

// ---------------------------------------------------------------------------
// 16. DASHBOARD AGGREGATION
// ---------------------------------------------------------------------------
// A plain "YYYY-MM-DD" parsed by new Date() is UTC midnight, while a Sheet's
// Date cell is local - every date is normalised to a local calendar date.
function parseDateOnly_(str) {
  if (!str) return null;
  const parts = String(str).split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function dateOnly_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function todayDateOnly_() { return dateOnly_(new Date()); }

function apiGetDashboardData(params) {
  const bills = ss_().getSheetByName(SHEET.BILLS).getDataRange().getValues();
  const items = ss_().getSheetByName(SHEET.BILL_ITEMS).getDataRange().getValues();
  const today = todayDateOnly_();

  let dateFrom = parseDateOnly_(params.dateFrom);
  let dateTo = parseDateOnly_(params.dateTo);
  if (dateFrom && dateFrom > today) dateFrom = today;
  if (dateTo && dateTo > today) dateTo = today;
  if (dateFrom && dateTo && dateFrom > dateTo) { const t = dateFrom; dateFrom = dateTo; dateTo = t; }

  // Customer ID (exact) and Product (exact) filters are mutually exclusive.
  let customerIdFilter = (params.customerId || '').trim();
  let productFilter = (params.product || '').trim();
  if (customerIdFilter && productFilter) productFilter = '';
  const mode = customerIdFilter ? 'customer' : (productFilter ? 'product' : 'all');

  const billMeta = {};
  for (let i = 1; i < bills.length; i++) {
    const row = bills[i];
    if (!row[0]) continue;
    const billDate = dateOnly_(new Date(row[1]));
    if (dateFrom && billDate < dateFrom) continue;
    if (dateTo && billDate > dateTo) continue;
    if (mode === 'customer' && String(row[2]).trim().toLowerCase() !== customerIdFilter.toLowerCase()) continue;
    billMeta[String(row[0])] = {
      customerId: String(row[2]),
      paymentMethod: row[8],
      paymentStatus: row[11],
      billerName: row[13] || row[12] || 'Unknown',
      qty: Number(row[9]) || 0,
      amount: Number(row[10]) || 0
    };
  }

  let totalSalesCount = 0, totalSalesAmount = 0, totalQtySold = 0;
  let cashAmount = 0, bankAmount = 0;
  const customerSet = new Set();
  const productTotals = {};
  const billerTotals = {};

  if (mode === 'product') {
    const billsWithProduct = new Set();
    for (let i = 1; i < items.length; i++) {
      const row = items[i];
      const billId = String(row[0]);
      const meta = billMeta[billId];
      if (!meta) continue;
      if (String(row[1]).trim().toLowerCase() !== productFilter.toLowerCase()) continue;
      const qty = Number(row[3]) || 0;
      const amount = Number(row[4]) || 0;
      totalQtySold += qty;
      totalSalesAmount += amount;
      billsWithProduct.add(billId);
      customerSet.add(meta.customerId);
      if (meta.paymentMethod === 'Cash') cashAmount += amount;
      if (meta.paymentMethod === 'Bank') bankAmount += amount;
      if (!billerTotals[meta.billerName]) billerTotals[meta.billerName] = { count: 0, amount: 0 };
      billerTotals[meta.billerName].amount += amount;
    }
    totalSalesCount = billsWithProduct.size;
    if (totalQtySold || totalSalesAmount) productTotals[productFilter] = { qty: totalQtySold, amount: totalSalesAmount };
    billsWithProduct.forEach(id => { billerTotals[billMeta[id].billerName].count += 1; });
  } else {
    Object.keys(billMeta).forEach(billId => {
      const meta = billMeta[billId];
      totalSalesCount++;
      totalSalesAmount += meta.amount;
      totalQtySold += meta.qty;
      customerSet.add(meta.customerId);
      if (meta.paymentMethod === 'Cash') cashAmount += meta.amount;
      if (meta.paymentMethod === 'Bank') bankAmount += meta.amount;
      if (!billerTotals[meta.billerName]) billerTotals[meta.billerName] = { count: 0, amount: 0 };
      billerTotals[meta.billerName].count += 1;
      billerTotals[meta.billerName].amount += meta.amount;
    });
    for (let i = 1; i < items.length; i++) {
      const row = items[i];
      if (!billMeta[String(row[0])]) continue;
      const name = row[1];
      if (!productTotals[name]) productTotals[name] = { qty: 0, amount: 0 };
      productTotals[name].qty += Number(row[3]) || 0;
      productTotals[name].amount += Number(row[4]) || 0;
    }
  }

  const productChart = Object.keys(productTotals).map(name => ({
    name: name, qty: productTotals[name].qty, amount: productTotals[name].amount
  })).sort((a, b) => b.qty - a.qty);

  const billerChart = Object.keys(billerTotals).map(name => ({
    label: name, value: billerTotals[name].count, amount: billerTotals[name].amount
  })).sort((a, b) => b.value - a.value);

  return {
    ok: true,
    serverBuild: BACKEND_BUILD,
    data: {
      mode: mode,
      totalSalesCount: totalSalesCount,
      totalSalesAmount: totalSalesAmount,
      totalQtySold: totalQtySold,
      uniqueCustomers: customerSet.size,
      cashAmount: cashAmount,
      bankAmount: bankAmount,
      productChart: productChart,
      billerChart: billerChart
    }
  };
}

// ---------------------------------------------------------------------------
// 16b. CUSTOM DASHBOARD CHARTS - Super Admin builds these on top of the
//      fixed default widgets (stored in the CustomCharts sheet).
// ---------------------------------------------------------------------------
function apiGetCustomCharts() {
  const sh = ss_().getSheetByName(SHEET.CUSTOM_CHARTS);
  const data = sh.getDataRange().getValues();
  const charts = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    charts.push({
      chartId: row[0], name: row[1], type: row[2], dataSource: row[3],
      dimension: row[4], metric: row[5], metricField: row[6],
      topN: Number(row[7]) || 0, sortDir: row[8] || 'desc', sortOrder: Number(row[9]) || 0,
      color: row[11] || ''
    });
  }
  charts.sort((a, b) => a.sortOrder - b.sortOrder);
  return { ok: true, charts: charts };
}

const CHART_DIMENSIONS_ = {
  bills: ['BillerName', 'PaymentMethod', 'PaymentStatus', 'CustomerName', 'CompanyName', 'Date', 'Month', 'Year'],
  billitems: ['ProductName'], customers: [], products: []
};
const CHART_METRIC_FIELDS_ = {
  bills: ['TotalAmount', 'TotalQty'], billitems: ['LineTotal', 'Qty'], customers: [], products: []
};

function validateChartDef_(p) {
  const validTypes = ['bar', 'pie', 'donut', 'number'];
  const validSources = ['bills', 'billitems', 'customers', 'products'];
  const validMetrics = ['sum', 'count', 'average'];
  const name = vFreeText_(p.name, 'Chart name', 60, true, 2);
  if (name.error) return name.error;
  p.name = name.value;
  if (validTypes.indexOf(p.type) === -1) return 'Invalid chart type.';
  if (validSources.indexOf(p.dataSource) === -1) return 'Invalid data source.';
  if (validMetrics.indexOf(p.metric) === -1) return 'Invalid metric.';
  if (p.type !== 'number' && (p.dataSource === 'customers' || p.dataSource === 'products')) {
    return 'Customers/Products can only be used with a Number chart (there\'s nothing to group them by).';
  }
  if (p.type !== 'number') {
    if (!p.dimension) return 'Choose a field to group by for this chart type.';
    if (CHART_DIMENSIONS_[p.dataSource].indexOf(p.dimension) === -1) return 'That Group By field does not belong to this data source.';
  } else {
    p.dimension = '';
  }
  if (p.metric === 'sum' || p.metric === 'average') {
    if (!p.metricField) return 'Choose which number field to use.';
    if (CHART_METRIC_FIELDS_[p.dataSource].indexOf(p.metricField) === -1) return 'That number field does not belong to this data source.';
  } else {
    p.metricField = '';
  }
  const topN = vInt_(p.topN === '' || p.topN == null ? 0 : p.topN, 'Show Top', 0, 100, false);
  if (topN.error) return topN.error;
  p.topN = topN.value;
  p.sortDir = p.sortDir === 'asc' ? 'asc' : 'desc';
  p.color = VR.HEX_COLOR.test(String(p.color || '')) ? p.color : '';
  return null;
}

function apiSaveCustomChart(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const err = validateChartDef_(p);
  if (err) return { ok: false, error: err };

  const sh = ss_().getSheetByName(SHEET.CUSTOM_CHARTS);
  const data = sh.getDataRange().getValues();

  if (p.chartId) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(p.chartId)) {
        sh.getRange(i + 1, 2, 1, 8).setValues([[
          cellSafe_(p.name), p.type, p.dataSource, p.dimension || '', p.metric,
          p.metricField || '', Number(p.topN) || 0, p.sortDir || 'desc'
        ]]);
        sh.getRange(i + 1, 12).setValue(p.color || '');
        return { ok: true, chartId: p.chartId };
      }
    }
    return { ok: false, error: 'Chart not found.' };
  }

  const maxOrder = data.reduce((m, row, i) => i === 0 ? m : Math.max(m, Number(row[9]) || 0), 0);
  const chartId = 'CHART-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sh.appendRow([
    chartId, cellSafe_(p.name), p.type, p.dataSource, p.dimension || '', p.metric,
    p.metricField || '', Number(p.topN) || 0, p.sortDir || 'desc', maxOrder + 1, new Date(), p.color || ''
  ]);
  return { ok: true, chartId: chartId };
}

function apiDeleteCustomChart(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const sh = ss_().getSheetByName(SHEET.CUSTOM_CHARTS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.chartId)) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Chart not found.' };
}

function apiReorderCustomCharts(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  const orderedIds = p.orderedChartIds;
  if (!Array.isArray(orderedIds)) return { ok: false, error: 'orderedChartIds must be a list.' };
  const sh = ss_().getSheetByName(SHEET.CUSTOM_CHARTS);
  const data = sh.getDataRange().getValues();
  orderedIds.forEach((chartId, idx) => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(chartId)) {
        sh.getRange(i + 1, 10).setValue(idx + 1);
        break;
      }
    }
  });
  return { ok: true };
}

function apiGetCustomChartData(p) {
  const sh = ss_().getSheetByName(SHEET.CUSTOM_CHARTS);
  const data = sh.getDataRange().getValues();
  let def = null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.chartId)) {
      def = {
        chartId: data[i][0], name: data[i][1], type: data[i][2], dataSource: data[i][3],
        dimension: data[i][4], metric: data[i][5], metricField: data[i][6],
        topN: Number(data[i][7]) || 0, sortDir: data[i][8] || 'desc'
      };
      break;
    }
  }
  if (!def) return { ok: false, error: 'Chart not found.' };

  const records = [];
  const tz = Session.getScriptTimeZone() || 'Asia/Kolkata';

  if (def.dataSource === 'bills') {
    const billsData = ss_().getSheetByName(SHEET.BILLS).getDataRange().getValues();
    const dimColMap = { BillerName: 13, PaymentMethod: 8, PaymentStatus: 11, CustomerName: 3, CompanyName: 23 };
    const metricColMap = { TotalAmount: 10, TotalQty: 9 };
    for (let i = 1; i < billsData.length; i++) {
      const row = billsData[i];
      if (!row[0]) continue;
      let dimVal;
      if (def.dimension === 'Date') dimVal = Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM-dd');
      else if (def.dimension === 'Month') dimVal = Utilities.formatDate(new Date(row[1]), tz, 'yyyy-MM');
      else if (def.dimension === 'Year') dimVal = Utilities.formatDate(new Date(row[1]), tz, 'yyyy');
      else dimVal = String(row[dimColMap[def.dimension]] || (def.dimension === 'CompanyName' ? '(No company)' : 'Unknown'));
      const rawVal = metricColMap[def.metricField] !== undefined ? (Number(row[metricColMap[def.metricField]]) || 0) : 1;
      records.push({ dim: dimVal, val: rawVal });
    }
  } else if (def.dataSource === 'billitems') {
    const itemsData = ss_().getSheetByName(SHEET.BILL_ITEMS).getDataRange().getValues();
    const metricColMap = { LineTotal: 4, Qty: 3 };
    for (let i = 1; i < itemsData.length; i++) {
      const row = itemsData[i];
      if (!row[0]) continue;
      const rawVal = metricColMap[def.metricField] !== undefined ? (Number(row[metricColMap[def.metricField]]) || 0) : 1;
      records.push({ dim: String(row[1] || 'Unknown'), val: rawVal });
    }
  } else if (def.dataSource === 'customers') {
    apiGetCustomersList().customers.forEach(() => records.push({ dim: 'Customers', val: 1 }));
  } else if (def.dataSource === 'products') {
    productsAll_().forEach(() => records.push({ dim: 'Products', val: 1 }));
  }

  function aggregate_(recs, metric) {
    if (!recs.length) return 0;
    if (metric === 'count') return recs.length;
    const sum = recs.reduce((s, r) => s + r.val, 0);
    if (metric === 'average') return sum / recs.length;
    return sum;
  }

  if (def.type === 'number') {
    return { ok: true, chartId: def.chartId, type: 'number', name: def.name, total: aggregate_(records, def.metric) };
  }

  const groups = {};
  records.forEach(r => { (groups[r.dim] || (groups[r.dim] = [])).push(r); });
  let entries = Object.keys(groups).map(k => ({ label: k, value: aggregate_(groups[k], def.metric) }));
  entries.sort((a, b) => def.sortDir === 'asc' ? a.value - b.value : b.value - a.value);
  if (def.topN > 0) entries = entries.slice(0, def.topN);

  return {
    ok: true, chartId: def.chartId, type: def.type, name: def.name,
    labels: entries.map(e => e.label), values: entries.map(e => e.value)
  };
}

// ---------------------------------------------------------------------------
// 17. REPORTS - read-only views every logged-in user can browse. Downloading
//     as Excel is gated per biller on the website (Report DL switch).
// ---------------------------------------------------------------------------
// The spreadsheet's time zone is looked up ONCE per spreadsheet per request.
const TZ_CACHE_ = new Map();
function fmtDate_(d, pattern, ssRef) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const ref = ssRef || ss_();
  let tz = TZ_CACHE_.get(ref);
  if (!tz) { tz = ref.getSpreadsheetTimeZone(); TZ_CACHE_.set(ref, tz); }
  return Utilities.formatDate(d, tz, pattern);
}

const REPORT_ROW_CAP = 5000;

// One row per PRODUCT LINE SOLD. Bill-level fields repeat across a bill's
// own lines (that's expected, not a duplicate). Discounts are broken out:
//   Gross Amount -> - Item Discount Amount -> - Bill Discount Amount -> Net LineTotal
// "Bill Total Qty" / "Bill Total Amount" repeat per line - never sum them
// directly; "First Line Of Bill" = TRUE marks one row per bill.
const UNIVERSAL_REPORT_HEADERS = [
  'CustomerID', 'Customer Name', 'Company Name', 'Customer GSTIN', 'Phone', 'Email', 'BillID', 'BillerID', 'Biller Name',
  'Invoice Date', 'Invoice Time', 'CreatedAt', 'Address', 'DeliveryAddress',
  'ProductName', 'HSN', 'UnitPrice', 'Qty', 'Gross Amount',
  'Item Discount %', 'Item Discount Amount',
  'Bill Discount %', 'Bill Discount Amount',
  'Net LineTotal', 'PaymentMethod',
  'Bill Total Qty', 'Bill Total Amount',
  'PaymentStatus', 'UpdatedAt', 'UpdatedBy', 'VersionNote',
  'ShowTaxOverride', 'ShowBankOverride', 'First Line Of Bill'
];

// Shared by the website report and the spreadsheet mirror tab.
function lineBreakdown_(item, bill) {
  const unitPrice = Number(item[2]) || 0;
  const qty = Number(item[3]) || 0;
  const lineTotal = Number(item[4]) || 0; // net, after BOTH discounts
  const itemDiscountPercent = Number(item[5]) || 0;
  const billDiscountPercent = Number(bill[22]) || 0;
  const grossAmount = unitPrice * qty;
  const itemDiscountAmount = grossAmount * itemDiscountPercent / 100;
  const afterItemDiscount = grossAmount - itemDiscountAmount;
  const billDiscountAmount = Math.max(0, afterItemDiscount - lineTotal);
  return {
    unitPrice: unitPrice, qty: qty, lineTotal: lineTotal, grossAmount: grossAmount,
    itemDiscountPercent: itemDiscountPercent, itemDiscountAmount: itemDiscountAmount,
    billDiscountPercent: billDiscountPercent, billDiscountAmount: billDiscountAmount
  };
}

function apiGetUniversalReport() {
  const rows = [];
  const seenBillIds = new Set();
  allDbs_().forEach(db => {
    const billsSh = db.ss.getSheetByName(SHEET.BILLS);
    const itemsSh = db.ss.getSheetByName(SHEET.BILL_ITEMS);
    if (!billsSh || !itemsSh) return;
    const billsData = billsSh.getDataRange().getValues();
    const billMap = {};
    for (let i = 1; i < billsData.length; i++) {
      const r = billsData[i];
      if (r[0]) billMap[String(r[0])] = r;
    }
    const itemsData = itemsSh.getDataRange().getValues();
    for (let i = 1; i < itemsData.length; i++) {
      const item = itemsData[i];
      if (!item[0]) continue;
      const bill = billMap[String(item[0])];
      if (!bill) continue;
      const isFirstLine = !seenBillIds.has(String(item[0]));
      seenBillIds.add(String(item[0]));
      const b = lineBreakdown_(item, bill);
      rows.push({
        customerId: bill[2],
        customerName: bill[3],
        companyName: bill[23] || '',
        customerGstin: bill[24] || '',
        phone: bill[4],
        email: bill[5],
        billId: bill[0],
        billerId: bill[12],
        billerName: bill[13],
        invoiceDate: fmtDate_(bill[1], 'yyyy-MM-dd', db.ss),
        invoiceTime: fmtDate_(bill[16], 'HH:mm:ss', db.ss),
        createdAt: fmtDate_(bill[16], 'yyyy-MM-dd HH:mm:ss', db.ss),
        address: bill[6],
        deliveryAddress: bill[7],
        productName: item[1],
        hsn: item[6] || '',
        unitPrice: b.unitPrice,
        qty: b.qty,
        grossAmount: b.grossAmount,
        itemDiscountPercent: b.itemDiscountPercent,
        itemDiscountAmount: b.itemDiscountAmount,
        billDiscountPercent: b.billDiscountPercent,
        billDiscountAmount: b.billDiscountAmount,
        lineTotal: b.lineTotal,
        paymentMethod: bill[8],
        totalQty: Number(bill[9]) || 0,
        totalAmount: Number(bill[10]) || 0,
        paymentStatus: bill[11],
        updatedAt: fmtDate_(bill[17], 'yyyy-MM-dd HH:mm', db.ss),
        updatedBy: bill[18] || '',
        versionNote: bill[19] || '',
        showTaxOverride: bill[20] || '',
        showBankOverride: bill[21] || '',
        source: db.label,
        isFirstLineOfBill: isFirstLine ? 'TRUE' : 'FALSE'
      });
    }
  });

  rows.sort((a, b) => {
    const ta = a.invoiceDate + ' ' + a.invoiceTime, tb = b.invoiceDate + ' ' + b.invoiceTime;
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  const truncated = rows.length > REPORT_ROW_CAP;
  return { ok: true, rows: rows.slice(0, REPORT_ROW_CAP), truncated: truncated };
}

// The same join as apiGetUniversalReport(), written as a real tab in the
// ACTIVE spreadsheet for anyone who opens the sheet directly.
function buildUniversalReportSheet_(pre) {
  pre = (pre && pre.bills) ? pre : readMirrorSource_();
  const ssRef = ss_();
  let sh = ssRef.getSheetByName(SHEET.UNIVERSAL_REPORT);
  if (!sh) sh = ssRef.insertSheet(SHEET.UNIVERSAL_REPORT);
  sh.clear();

  const billMap = {};
  for (let i = 1; i < pre.bills.length; i++) {
    const r = pre.bills[i];
    if (r[0]) billMap[String(r[0])] = r;
  }

  const dataRows = [];
  const seenBillIds = new Set();
  let totalGrossAmount = 0, totalItemDiscount = 0, totalBillDiscount = 0, totalLineRevenue = 0, totalQtySold = 0;
  for (let i = 1; i < pre.items.length; i++) {
    const item = pre.items[i];
    if (!item[0]) continue;
    const bill = billMap[String(item[0])];
    if (!bill) continue;
    const isFirstLine = !seenBillIds.has(String(item[0]));
    seenBillIds.add(String(item[0]));
    const b = lineBreakdown_(item, bill);
    totalGrossAmount += b.grossAmount;
    totalItemDiscount += b.itemDiscountAmount;
    totalBillDiscount += b.billDiscountAmount;
    totalLineRevenue += b.lineTotal;
    totalQtySold += b.qty;
    dataRows.push([
      bill[2], bill[3], bill[23] || '', bill[24] || '', bill[4], bill[5], bill[0], bill[12], bill[13],
      fmtDate_(bill[1], 'yyyy-MM-dd'), fmtDate_(bill[16], 'HH:mm:ss'), fmtDate_(bill[16], 'yyyy-MM-dd HH:mm:ss'),
      bill[6], bill[7],
      item[1], item[6] || '', b.unitPrice, b.qty, b.grossAmount,
      b.itemDiscountPercent, b.itemDiscountAmount,
      b.billDiscountPercent, b.billDiscountAmount,
      b.lineTotal,
      bill[8], Number(bill[9]) || 0, Number(bill[10]) || 0,
      bill[11], fmtDate_(bill[17], 'yyyy-MM-dd HH:mm'), bill[18] || '', bill[19] || '',
      bill[20] || '', bill[21] || '', isFirstLine
    ]);
  }

  const numCols = UNIVERSAL_REPORT_HEADERS.length;
  const totalDiscountGiven = totalItemDiscount + totalBillDiscount;
  sh.getRange(1, 1, 1, numCols).merge();
  sh.getRange(1, 1)
    .setValue('SALES SUMMARY - ' + seenBillIds.size + ' bill(s)  |  Gross (Before Discount): ₹' +
      totalGrossAmount.toLocaleString('en-IN') + '  |  Total Discount Given: ₹' + totalDiscountGiven.toLocaleString('en-IN') +
      ' (Item: ₹' + totalItemDiscount.toLocaleString('en-IN') + ' + Bill: ₹' + totalBillDiscount.toLocaleString('en-IN') + ')' +
      '  |  Net Sales (Actually Earned): ₹' + totalLineRevenue.toLocaleString('en-IN') + '  |  Total Qty Sold: ' + totalQtySold)
    .setFontWeight('bold').setFontSize(12).setBackground('#B8232A').setFontColor('#FFFFFF')
    .setHorizontalAlignment('left');

  sh.getRange(2, 1, 1, numCols).merge();
  sh.getRange(2, 1)
    .setValue('⚠ "Bill Total Qty" and "Bill Total Amount" repeat once per product line within the same bill - ' +
      'do NOT sum those two columns directly, they will over-count. "Qty", "Gross Amount", "Item Discount Amount", ' +
      '"Bill Discount Amount" and "Net LineTotal" are unique per row and safe to sum (the two "%" columns are rates, ' +
      'not money). Filter "First Line Of Bill" = TRUE first if you need to sum the two bill-level columns instead.')
    .setFontStyle('italic').setFontSize(9.5).setFontColor('#7A3A12').setBackground('#FDECEA')
    .setWrap(true);
  sh.setRowHeight(2, 34);

  sh.getRange(3, 1, 1, numCols).merge();
  sh.getRange(3, 1).setValue('').setBackground('#FFFFFF');

  const HEADER_ROW = 4;
  sh.getRange(HEADER_ROW, 1, 1, numCols).setValues([UNIVERSAL_REPORT_HEADERS]);
  sh.getRange(HEADER_ROW, 1, 1, numCols).setFontWeight('bold').setBackground('#B8232A').setFontColor('#FFFFFF');
  const noteText = 'Repeats once per product line on the same bill - do not SUM this column directly. See the summary at the top of this sheet, or filter "First Line Of Bill" = TRUE first.';
  const c1 = UNIVERSAL_REPORT_HEADERS.indexOf('Bill Total Qty') + 1;
  const c2 = UNIVERSAL_REPORT_HEADERS.indexOf('Bill Total Amount') + 1;
  if (c1 > 0) sh.getRange(HEADER_ROW, c1).setNote(noteText);
  if (c2 > 0) sh.getRange(HEADER_ROW, c2).setNote(noteText);

  if (dataRows.length) {
    sh.getRange(HEADER_ROW + 1, 1, dataRows.length, numCols).setValues(dataRows.map(row => row.map(cellSafe_)));
  }
  sh.setFrozenRows(HEADER_ROW);
  if (dataRows.length <= MIRROR_AUTOFIT_MAX_ROWS) {
    try { sh.autoResizeColumns(1, numCols); } catch (e) { /* cosmetic only */ }
  }
}

// One row per (Date, Product) - ONLY when something happened that day
// (stock added, or it sold). "Net Revenue" is what was actually earned.
function addDailyRows_(map, stockData, billsData, itemsData, ssRef) {
  const getRow = (dateStr, product) => {
    const key = dateStr + '||' + String(product).trim().toLowerCase();
    if (!map[key]) map[key] = { date: dateStr, product: product, addedToStock: 0, qtySold: 0, grossRevenue: 0, itemDiscount: 0, billDiscount: 0, revenue: 0 };
    return map[key];
  };
  for (let i = 1; i < stockData.length; i++) {
    const r = stockData[i];
    if (!r[0]) continue;
    const delta = Number(r[4]) || 0;
    if (delta <= 0) continue;
    getRow(fmtDate_(r[0], 'yyyy-MM-dd', ssRef), r[2]).addedToStock += delta;
  }
  const billMap = {};
  for (let i = 1; i < billsData.length; i++) {
    const r = billsData[i];
    if (r[0]) billMap[String(r[0])] = r;
  }
  for (let i = 1; i < itemsData.length; i++) {
    const item = itemsData[i];
    if (!item[0]) continue;
    const bill = billMap[String(item[0])];
    if (!bill) continue;
    const row = getRow(fmtDate_(bill[1], 'yyyy-MM-dd', ssRef), item[1]);
    const b = lineBreakdown_(item, bill);
    row.qtySold += b.qty;
    row.grossRevenue += b.grossAmount;
    row.itemDiscount += b.itemDiscountAmount;
    row.billDiscount += b.billDiscountAmount;
    row.revenue += b.lineTotal;
  }
}
function sortDailyRows_(map) {
  return Object.values(map).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(a.product).localeCompare(String(b.product));
  });
}

function apiGetDailyReport() {
  const map = {};
  allDbs_().forEach(db => {
    const read = name => { const sh = db.ss.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; };
    addDailyRows_(map, read(SHEET.STOCK_LOG), read(SHEET.BILLS), read(SHEET.BILL_ITEMS), db.ss);
  });
  const rows = sortDailyRows_(map);
  return { ok: true, rows: rows.slice(0, REPORT_ROW_CAP), truncated: rows.length > REPORT_ROW_CAP };
}

const DAILY_REPORT_HEADERS = [
  'Date', 'Product', 'Added To Stock', 'Qty Sold',
  'Gross Revenue', 'Item Discount', 'Bill Discount', 'Net Revenue (Actually Earned)'
];

function buildDailyReportSheet_(pre) {
  pre = (pre && pre.bills) ? pre : readMirrorSource_();
  const ssRef = ss_();
  let sh = ssRef.getSheetByName(SHEET.DAILY_REPORT);
  if (!sh) sh = ssRef.insertSheet(SHEET.DAILY_REPORT);
  sh.clear();
  const map = {};
  addDailyRows_(map, pre.stock, pre.bills, pre.items, ssRef);
  const rows = sortDailyRows_(map);
  const out = [DAILY_REPORT_HEADERS].concat(rows.map(r =>
    [r.date, r.product, r.addedToStock, r.qtySold, r.grossRevenue, r.itemDiscount, r.billDiscount, r.revenue]
  ));
  sh.getRange(1, 1, out.length, DAILY_REPORT_HEADERS.length).setValues(out.map(row => row.map(cellSafe_)));
  sh.getRange(1, 1, 1, DAILY_REPORT_HEADERS.length).setFontWeight('bold').setBackground('#B8232A').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  if (rows.length <= MIRROR_AUTOFIT_MAX_ROWS) {
    try { sh.autoResizeColumns(1, DAILY_REPORT_HEADERS.length); } catch (e) { /* cosmetic only */ }
  }
}

// Raw stock audit trail (skips zero-change rows).
function apiGetInventoryLogReport() {
  const rows = [];
  allDbs_().forEach(db => {
    const sh = db.ss.getSheetByName(SHEET.STOCK_LOG);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0]) continue;
      const delta = Number(r[4]) || 0;
      if (delta === 0) continue;
      rows.push({
        date: fmtDate_(r[0], 'yyyy-MM-dd', db.ss),
        time: fmtDate_(r[0], 'HH:mm:ss', db.ss),
        billerId: r[10] || '',
        performedBy: r[9] || r[7],
        role: r[8] || '',
        product: r[2],
        action: r[3],
        change: delta,
        newStock: Number(r[5]) || 0,
        billId: r[6] || '',
        source: db.label
      });
    }
  });
  rows.sort((a, b) => {
    const ta = a.date + ' ' + a.time, tb = b.date + ' ' + b.time;
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  return { ok: true, rows: rows.slice(0, REPORT_ROW_CAP), truncated: rows.length > REPORT_ROW_CAP };
}

// ---------------------------------------------------------------------------
// 18. DATABASE SET-UP
// ---------------------------------------------------------------------------
// Creates every tab + header row this app needs on WHATEVER spreadsheet is
// passed in. Used by setupDatabase() and by "Add New Database".
function provisionSchemaOnSpreadsheet_(ssRef) {
  createSheetIfMissing_(ssRef, SHEET.SETTINGS, ['Key', 'Value']);
  createSheetIfMissing_(ssRef, SHEET.BILLERS, BILLERS_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.CUSTOMERS, CUSTOMERS_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.PRODUCTS, PRODUCTS_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.STOCK_LOG, STOCK_LOG_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.BILLS, BILLS_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.BILL_ITEMS, BILL_ITEMS_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.DASHBOARD, ['This tab is a snapshot - the live charts are on the website.']);
  createSheetIfMissing_(ssRef, SHEET.UNIVERSAL_REPORT, UNIVERSAL_REPORT_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.DAILY_REPORT, DAILY_REPORT_HEADERS);
  createSheetIfMissing_(ssRef, SHEET.CUSTOM_CHARTS, CUSTOM_CHARTS_HEADERS);
  // ID / code / phone columns are plain text, so "0001" never becomes 1.
  [[SHEET.PRODUCTS, 1], [SHEET.PRODUCTS, 8], [SHEET.BILL_ITEMS, 7], [SHEET.CUSTOMERS, 3], [SHEET.BILLS, 5]].forEach(function (pair) {
    const sh = ssRef.getSheetByName(pair[0]);
    if (sh) sh.getRange(2, pair[1], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  });
}

function createSheetIfMissing_(ssRef, name, headers) {
  let sh = ssRef.getSheetByName(name);
  if (!sh) sh = ssRef.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(SHEET_HEADER_BG).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Menu: KLG Billing -> 1. Set up database (first time only).
// Safe to run again - it never overwrites existing rows.
function setupDatabase() {
  const ssRef = ss_();
  provisionSchemaOnSpreadsheet_(ssRef);

  const settingsSh = ssRef.getSheetByName(SHEET.SETTINGS);
  if (settingsSh.getLastRow() < 2) {
    const defaults = defaultShopSettings_().concat(THEME_SETTING_DEFAULTS);
    settingsSh.getRange(2, 1, defaults.length, 2).setValues(defaults.map(r => [r[0], cellSafe_(r[1])]));
  }
  // No billers and no products are created - the Super Admin adds both
  // from the website. No usernames or passwords are created here either.

  PropertiesService.getScriptProperties().setProperty('SchemaVersion', String(SCHEMA_VERSION));
  clearAllCache_();
  buildUniversalReportSheet_();
  buildDailyReportSheet_();

  uiAlert_('Database ready!\n\nAll tabs and default shop details are in place.\n\n' +
    (superAdminConfig_() ? 'Next: KLG Billing menu > "3. Turn on speed-up & monthly backup" (if not done yet).'
      : 'Next: KLG Billing menu > "2. Set / change Super Admin login".'));
}

// Shows a message in the spreadsheet when run from it; logs otherwise.
function uiAlert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// ---------------------------------------------------------------------------
// 19. THE "KLG Billing" MENU INSIDE THE GOOGLE SHEET
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('KLG Billing')
    .addItem('1. Set up database (first time only)', 'setupDatabase')
    .addItem('2. Set / change Super Admin login', 'openSuperAdminDialog')
    .addItem('3. Turn on speed-up & monthly backup', 'installAutomations')
    .addSeparator()
    .addItem('Refresh app data (after editing this sheet by hand)', 'clearAppCache')
    .addItem('Make a backup copy now', 'monthlyBackup')
    .addToUi();
}

// A small form inside the Google Sheet. Only people who can edit the
// spreadsheet itself can ever see or use it - a stranger who finds the
// website link cannot create or change the Super Admin login.
function openSuperAdminDialog() {
  const cfg = superAdminConfig_();
  const html = HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial,sans-serif;font-size:13px;color:#1F1B1B;margin:0;padding:4px 2px;}' +
    'label{display:block;font-weight:700;margin:10px 0 4px;font-size:12px;}' +
    'input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:14px;}' +
    'button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:6px;background:#EB343A;color:#fff;font-weight:700;font-size:14px;cursor:pointer;}' +
    'button:disabled{opacity:.6;} .hint{color:#5A5150;font-size:11.5px;line-height:1.5;} .err{color:#C64B3E;font-weight:700;margin-top:10px;} .ok{color:#1F7A3E;font-weight:700;margin-top:10px;}</style>' +
    '<div class="hint">' + (cfg ? 'Current username: <b>' + escHtml_(cfg.user) + '</b>. Saving here replaces the login and signs out every Super Admin session.' : 'Create the Super Admin login for the website. Nothing is saved in the spreadsheet - only a scrambled fingerprint of the password is kept privately by the script.') + '</div>' +
    '<label for="u">Username (3-40 characters)</label><input id="u" autocomplete="off" value="' + (cfg ? escHtml_(cfg.user) : '') + '">' +
    '<label for="p">Password (8-30 characters, no spaces)</label><input id="p" type="password" autocomplete="new-password">' +
    '<label for="c">Type the password again</label><input id="c" type="password" autocomplete="new-password">' +
    '<button id="b" onclick="go()">Save Super Admin login</button><div id="m"></div>' +
    '<script>function go(){var u=document.getElementById("u").value,p=document.getElementById("p").value,c=document.getElementById("c").value,m=document.getElementById("m"),b=document.getElementById("b");' +
    'm.className="";m.textContent="";if(p!==c){m.className="err";m.textContent="The two passwords do not match.";return;}b.disabled=true;b.textContent="Saving...";' +
    'google.script.run.withSuccessHandler(function(r){b.disabled=false;b.textContent="Save Super Admin login";if(r.ok){m.className="ok";m.textContent="Saved. You can now log in on the website with this username and password.";document.getElementById("p").value="";document.getElementById("c").value="";}else{m.className="err";m.textContent=r.error;}})' +
    '.withFailureHandler(function(e){b.disabled=false;b.textContent="Save Super Admin login";m.className="err";m.textContent=String(e);}).saveSuperAdminFromDialog(u,p);}</script>'
  ).setWidth(380).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Super Admin login');
}

// Called only by the dialog above.
function saveSuperAdminFromDialog(user, password) {
  const u = vLine_(user);
  if (u.length < 3 || u.length > 40 || !VR.ADMIN_USER.test(u)) {
    return { ok: false, error: 'Username must be 3 to 40 characters - letters, numbers, spaces and . _ - @ only.' };
  }
  if (findBillerRow_(u)) return { ok: false, error: 'That username is already used as a Biller ID. Pick another.' };
  const pw = vPassword_(password, 'Password', 8, true);
  if (pw.error) return { ok: false, error: pw.error };
  setSuperAdmin_(u, pw.value);
  clearFailedLogins_(u);
  clearFailedLogins_('admin-confirm');
  return { ok: true };
}

// Menu: "Refresh app data" - after editing the spreadsheet by hand, this
// makes the website pick the changes up straight away.
function clearAppCache() {
  clearAllCache_();
  uiAlert_('Done - the website will now show the latest data from this spreadsheet.');
}

// ---------------------------------------------------------------------------
// 20. SPEED-UP ("keep warm") + MONTHLY BACKUP
//     installAutomations() - run once from the KLG Billing menu - creates:
//       - keepWarm every 10 minutes: wakes the script and refreshes the
//         cached settings / products / billers / customer list, so the first
//         screen after a quiet spell loads fast. (Google may still take a
//         moment now and then - this makes slow starts much rarer.)
//       - monthlyBackup on the 1st of every month (~2 AM): a full copy of
//         the spreadsheet into the Drive folder "KLG Billing Backups - CBE";
//         the newest 12 copies are kept, older ones move to Drive's Trash.
// ---------------------------------------------------------------------------
const BACKUPS_TO_KEEP_ = 12;

function installAutomations() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'keepWarm' || fn === 'monthlyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('monthlyBackup').timeBased().onMonthDay(1).atHour(2).create();
  keepWarm();
  uiAlert_('Done!\n\n- Speed-up runs every 10 minutes.\n- A backup copy is made on the 1st of every month (the last ' + BACKUPS_TO_KEEP_ +
    ' are kept in the Drive folder "KLG Billing Backups - ' + BRANCH.CODE + '").\n\nYou only need to do this once.');
}

function keepWarm() {
  try {
    ['settings', 'products', 'billers', 'customers', 'capacity'].forEach(function (n) { invalidateCache_(n); });
    getSettingsMap_();
    productsAll_();
    billersRaw_();
    apiGetCustomersList();
    apiGetCapacityStatus();
  } catch (e) {
    Logger.log('keepWarm: ' + e);
  }
}

function monthlyBackup() {
  const ssRef = ss_();
  const folderName = 'KLG Billing Backups - ' + BRANCH.CODE;
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  DriveApp.getFileById(ssRef.getId()).makeCopy(ssRef.getName() + ' - Backup ' + stamp, folder);

  const files = [];
  const fit = folder.getFiles();
  while (fit.hasNext()) files.push(fit.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(BACKUPS_TO_KEEP_).forEach(function (f) { f.setTrashed(true); });
  Logger.log('Backup made in "' + folderName + '" (' + Math.min(files.length, BACKUPS_TO_KEEP_) + ' kept).');
  try { SpreadsheetApp.getActive().toast('Backup copy saved to Drive folder "' + folderName + '".', 'KLG Billing', 6); } catch (e) { /* run by the timer - no screen */ }
}

// One-time helper: puts the default theme back from the Apps Script editor
// (select forceResetThemeNow at the top, then Run) - no website login needed.
function forceResetThemeNow() {
  const map = {};
  THEME_SETTING_DEFAULTS.forEach(pair => { map[pair[0]] = pair[1]; });
  setSettings_(map);
}

// ---------------------------------------------------------------------------
// 21. SPREADSHEET MIRROR TABS (Dashboard / UniversalReport / DailyReport)
//     Copies of what the website computes live, for anyone opening the
//     Google Sheet directly. Rebuilt after every bill save/edit - AFTER the
//     billing lock is released, from one shared read, and coalesced so two
//     saves at the same moment don't both rebuild.
// ---------------------------------------------------------------------------
const MIRROR_AUTOFIT_MAX_ROWS = 300;
const MIRROR_PARTS_ = ['dashboard', 'universal', 'daily'];

function apiRefreshDashboardSheet(p) {
  const auth = requireSuperAdmin_(p.superAdminUser, p.superAdminPass);
  if (!auth.ok) return auth;
  refreshMirrorSheets_({ dashboard: true, universal: true, daily: true });
  clearAllCache_();
  return { ok: true };
}

function readMirrorSource_() {
  const ssRef = ss_();
  const read = function (name) {
    const sh = ssRef.getSheetByName(name);
    return sh ? sh.getDataRange().getValues() : [];
  };
  return { bills: read(SHEET.BILLS), items: read(SHEET.BILL_ITEMS), stock: read(SHEET.STOCK_LOG) };
}

function refreshMirrorSheets_(parts) {
  // A mirror-tab problem must never turn a SAVED bill into an error.
  try { refreshMirrorSheetsInner_(parts || {}); }
  catch (e) { Logger.log('Mirror tab refresh skipped: ' + e); }
}

function refreshMirrorSheetsInner_(parts) {
  const cache = CacheService.getScriptCache();
  const dirtyKey = function (part) { return 'mirror_dirty_' + ss_().getId() + '_' + part; };
  MIRROR_PARTS_.forEach(function (part) { if (parts[part]) cache.put(dirtyKey(part), '1', 21600); });

  let lock = null;
  try { lock = LockService.getUserLock(); } catch (e) { lock = null; }
  if (lock && !lock.tryLock(30000)) return;
  try {
    const todo = {};
    let any = false;
    MIRROR_PARTS_.forEach(function (part) {
      if (cache.get(dirtyKey(part))) { todo[part] = true; any = true; cache.remove(dirtyKey(part)); }
    });
    if (!any) return;
    const pre = readMirrorSource_();
    if (todo.dashboard) { try { buildDashboardSheet(pre); } catch (e) { cache.put(dirtyKey('dashboard'), '1', 21600); Logger.log('Dashboard tab rebuild failed: ' + e); } }
    if (todo.universal) { try { buildUniversalReportSheet_(pre); } catch (e) { cache.put(dirtyKey('universal'), '1', 21600); Logger.log('UniversalReport tab rebuild failed: ' + e); } }
    if (todo.daily) { try { buildDailyReportSheet_(pre); } catch (e) { cache.put(dirtyKey('daily'), '1', 21600); Logger.log('DailyReport tab rebuild failed: ' + e); } }
  } finally {
    if (lock) lock.releaseLock();
  }
}

function buildDashboardSheet(pre) {
  pre = (pre && pre.bills) ? pre : readMirrorSource_();
  const ssRef = ss_();
  let sh = ssRef.getSheetByName(SHEET.DASHBOARD);
  if (!sh) sh = ssRef.insertSheet(SHEET.DASHBOARD);
  sh.clear();
  sh.getCharts().forEach(c => sh.removeChart(c));

  const bills = pre.bills;
  const items = pre.items;
  let totalSalesCount = 0, totalSalesAmount = 0, totalQtySold = 0;
  let cashAmount = 0, bankAmount = 0;
  const customerSet = {};
  for (let i = 1; i < bills.length; i++) {
    const row = bills[i];
    if (!row[0]) continue;
    totalSalesCount++;
    totalSalesAmount += Number(row[10]) || 0;
    if (row[2]) customerSet[row[2]] = true;
    if (String(row[8]) === 'Cash') cashAmount += Number(row[10]) || 0;
    else if (String(row[8]) === 'Bank') bankAmount += Number(row[10]) || 0;
  }
  const uniqueCustomers = Object.keys(customerSet).length;

  const productTotals = {};
  for (let i = 1; i < items.length; i++) {
    const row = items[i];
    if (!row[1]) continue;
    const name = String(row[1]);
    if (!productTotals[name]) productTotals[name] = { qty: 0, amount: 0 };
    productTotals[name].qty += Number(row[3]) || 0;
    productTotals[name].amount += Number(row[4]) || 0;
    totalQtySold += Number(row[3]) || 0;
  }
  const productRows = Object.keys(productTotals)
    .map(name => [name, productTotals[name].qty, productTotals[name].amount])
    .sort((a, b) => b[1] - a[1]);

  const title = (getSettingsMap_().CompanyName || ('Kovai Lakshmi Grinders - ' + BRANCH.NAME)) + ' - SALES DASHBOARD';
  sh.getRange('A1').setValue(title).setFontWeight('bold').setFontSize(15).setFontColor('#B8232A');
  sh.getRange('A1:D1').merge();

  const kpiLabels = ['Total Bills', 'Total Sales (Amount)', 'Total Products Sold', 'Unique Customers'];
  const kpiValues = [totalSalesCount, totalSalesAmount, totalQtySold, uniqueCustomers];
  for (let i = 0; i < kpiLabels.length; i++) {
    sh.getRange(3 + i, 1).setValue(kpiLabels[i]).setFontWeight('bold');
    sh.getRange(3 + i, 2).setValue(kpiValues[i]);
  }
  sh.getRange('B3:B6').setBackground('#FDEBEC').setFontWeight('bold').setFontSize(13);

  const prodStartRow = 9;
  sh.getRange(prodStartRow - 1, 1).setValue('Product-wise Quantity Sold').setFontWeight('bold').setFontSize(12);
  sh.getRange(prodStartRow, 1, 1, 3).setValues([['Product', 'Qty Sold', 'Amount (₹)']])
    .setFontWeight('bold').setBackground(SHEET_HEADER_BG).setFontColor('#FFFFFF');
  if (productRows.length) {
    sh.getRange(prodStartRow + 1, 1, productRows.length, 3).setValues(productRows.map(row => row.map(cellSafe_)));
  }

  const payStartRow = prodStartRow + productRows.length + 4;
  sh.getRange(payStartRow - 1, 1).setValue('Cash vs Bank (Amount Received)').setFontWeight('bold').setFontSize(12);
  sh.getRange(payStartRow, 1, 1, 2).setValues([['Method', 'Amount (₹)']])
    .setFontWeight('bold').setBackground(SHEET_HEADER_BG).setFontColor('#FFFFFF');
  sh.getRange(payStartRow + 1, 1, 2, 2).setValues([['Cash', cashAmount], ['Bank', bankAmount]]);

  sh.autoResizeColumns(1, 3);

  if (productRows.length) {
    sh.insertChart(sh.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(sh.getRange(prodStartRow, 1, productRows.length + 1, 2))
      .setPosition(3, 5, 0, 0)
      .setOption('title', 'Product-wise Quantity Sold')
      .setOption('colors', ['#EB343A'])
      .setOption('legend', { position: 'none' })
      .setOption('width', 480)
      .setOption('height', 300)
      .build());
  }
  sh.insertChart(sh.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sh.getRange(payStartRow, 1, 3, 2))
    .setPosition(20, 5, 0, 0)
    .setOption('title', 'Cash vs Bank (Amount Received)')
    .setOption('colors', ['#F48F33', '#EB343A'])
    .setOption('width', 480)
    .setOption('height', 300)
    .build());
}
