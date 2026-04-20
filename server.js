const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Disable caching for all pages
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);

// Database
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, 'data', 'awwal.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hide_name INTEGER DEFAULT 0,
    email TEXT,
    done_regrets TEXT NOT NULL,
    notdone_regrets TEXT NOT NULL,
    comment TEXT DEFAULT '',
    category TEXT DEFAULT 'شخصي',
    approved INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    source TEXT DEFAULT 'submission',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_stats (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    parent_id INTEGER,
    name TEXT NOT NULL,
    email TEXT,
    comment TEXT NOT NULL,
    approved INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(story_id) REFERENCES stories(id),
    FOREIGN KEY(parent_id) REFERENCES comments(id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    vote_type INTEGER NOT NULL,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comment_id, ip)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER,
    comment_id INTEGER,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    user TEXT NOT NULL DEFAULT 'system',
    details TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add columns if missing
try { db.exec('ALTER TABLE stories ADD COLUMN category TEXT DEFAULT \'شخصي\''); } catch(e) {}
try { db.exec('ALTER TABLE stories ADD COLUMN featured INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE stories ADD COLUMN user_id TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE stories ADD COLUMN pinned INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE stories ADD COLUMN image_url TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE admins ADD COLUMN role TEXT DEFAULT \'super\''); } catch(e) {}
try { db.exec('ALTER TABLE comments ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch(e) {}

// Multer config
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `story-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});
try { db.exec('ALTER TABLE comments ADD COLUMN user_id TEXT'); } catch(e) {}

// Default admin
const adminExists = db.prepare('SELECT id FROM admins').get();
if (!adminExists) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO admins (username, password, role) VALUES (?, ?, ?)').run(process.env.ADMIN_USERNAME, hash, 'super');
  console.log('✅ Default admin created. Change password immediately!');
}

// Init stats
const stats = db.prepare('INSERT OR IGNORE INTO site_stats (key, value) VALUES (?, ?)');
stats.run('total_views', 0);
stats.run('total_submissions', 0);

// Init settings
const settings = db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)');
settings.run('require_approval', '1');
settings.run('adsense_header', '');
settings.run('adsense_footer', '');
settings.run('custom_head_code', '');
settings.run('weekly_question', '');
settings.run('active_theme', 'red');
settings.run('show_categories', '0');
settings.run('show_advanced_submit', '1');
settings.run('show_separate_regrets', '0');
settings.run('show_leaderboard', '0');
settings.run('show_compare', '0');
settings.run('show_stats_page', '0');
settings.run('show_weekly_question', '1');
settings.run('show_related_stories', '0');
settings.run('show_search', '0');
settings.run('comments_mode', 'open');
settings.run('date_format', 'gregorian');
settings.run('allow_image_upload', '0');

// Theme definitions
const THEMES = {
  red:    { name: 'الأحمر', primary: '#dc2626', hover: '#b91c1c', light: '#f87171', glow: 'rgba(220,38,38,0.25)', accent: '#ef4444' },
  purple: { name: 'البنفسجي', primary: '#7c3aed', hover: '#6d28d9', light: '#a78bfa', glow: 'rgba(124,58,237,0.25)', accent: '#8b5cf6' },
  blue:   { name: 'الأزرق', primary: '#2563eb', hover: '#1d4ed8', light: '#60a5fa', glow: 'rgba(37,99,235,0.25)', accent: '#3b82f6' },
  green:  { name: 'الأخضر', primary: '#059669', hover: '#047857', light: '#34d399', glow: 'rgba(5,150,105,0.25)', accent: '#10b981' },
  orange: { name: 'البرتقالي', primary: '#ea580c', hover: '#c2410c', light: '#fb923c', glow: 'rgba(234,88,12,0.25)', accent: '#f97316' }
};

// Theme middleware
app.use((req, res, next) => {
  let themeKey = req.cookies.awwal_theme || getSetting('active_theme') || 'red';
  if (!THEMES[themeKey]) themeKey = 'red';
  res.locals.theme = THEMES[themeKey];
  res.locals.themeKey = themeKey;
  res.locals.allThemes = THEMES;
  res.locals.features = getFeatureSettings();
  res.locals.dateFormat = getSetting('date_format') || 'gregorian';
  next();
});

function getSetting(key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

function getFeatureSettings() {
  const keys = ['show_categories','show_advanced_submit','show_separate_regrets','show_leaderboard','show_compare','show_stats_page','show_weekly_question','show_related_stories','show_search','allow_image_upload'];
  const f = {};
  keys.forEach(k => { f[k] = getSetting(k) === '1'; });
  return f;
}

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    if (decoded !== 'admin_session') return res.redirect('/admin/login');
    next();
  } catch {
    res.redirect('/admin/login');
  }
}

function getAdminUsername(req) {
  try {
    const token = req.cookies.admin_session_user;
    return token ? Buffer.from(token, 'base64').toString() : 'admin';
  } catch { return 'admin'; }
}

function requireSuper(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    if (decoded !== 'admin_session') return res.redirect('/admin/login');
    const username = getAdminUsername(req);
    const admin = db.prepare('SELECT role FROM admins WHERE username = ?').get(username);
    if (!admin || admin.role !== 'super') {
      return res.status(403).render('admin/forbidden', { layout: 'admin/layout', title: 'غير مصرح' });
    }
    next();
  } catch {
    res.redirect('/admin/login');
  }
}

function requireModerator(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    if (decoded !== 'admin_session') return res.redirect('/admin/login');
    next();
  } catch {
    res.redirect('/admin/login');
  }
}

// Audit logging
function auditLog(action, user, details, ip) {
  db.prepare('INSERT INTO audit_log (action, user, details, ip) VALUES (?, ?, ?, ?)').run(action, user || 'system', details || '', ip || '');
}

function logWithAudit(req, action, details) {
  logActivity(action, details);
  auditLog(action, getAdminUsername(req), details, req.ip);
}

// ============ PUBLIC ROUTES ============

// Dynamic categories from DB
function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
}

// Initialize default categories if table is empty
function initCategories() {
  const defaults = [
    { name: 'علاقات', icon: '❤️', color: 'pink' },
    { name: 'دراسة', icon: '📚', color: 'blue' },
    { name: 'عمل', icon: '💼', color: 'amber' },
    { name: 'صحة', icon: '🏥', color: 'green' },
    { name: 'سفر', icon: '✈️', color: 'sky' },
    { name: 'مال', icon: '💰', color: 'yellow' },
    { name: 'عائلة', icon: '👨‍👩‍👧‍👦', color: 'purple' },
    { name: 'شخصي', icon: '🌟', color: 'brand' }
  ];
  const existing = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (existing.c === 0) {
    const stmt = db.prepare('INSERT INTO categories (name, icon, color, active, sort_order) VALUES (?, ?, ?, 1, ?)');
    defaults.forEach((d, i) => stmt.run(d.name, d.icon, d.color, i));
  }
}

try { db.exec('CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, icon TEXT DEFAULT \"🌟\", color TEXT DEFAULT \"brand\", active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)'); } catch(e) {}
initCategories();

function CATEGORIES() { return getCategories().filter(c => c.active); }
function ALL_CATEGORIES() { return getCategories(); }

// Home
app.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const sort = req.query.sort || 'latest';
  const category = req.query.category || '';
  const search = req.query.q || '';
  const perPage = 10;
  const offset = (page - 1) * perPage;

  let where = 'WHERE s.approved = 1';
  const params = [];

  if (category) {
    where += ' AND s.category = ?';
    params.push(category);
  }
  if (search) {
    where += ' AND (s.name LIKE ? OR s.comment LIKE ? OR s.done_regrets LIKE ? OR s.notdone_regrets LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  let order = 'ORDER BY s.created_at DESC';
  if (sort === 'views') order = 'ORDER BY s.views DESC';
  else if (sort === 'reacts') order = 'ORDER BY total_reacts DESC';
  else if (sort === 'random') order = 'ORDER BY RANDOM()';

  const stories = db.prepare(`
    SELECT s.*, (SELECT COALESCE(SUM(r.count),0) FROM reactions r WHERE r.story_id = s.id) as total_reacts
    FROM stories s ${where} ${order} LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  stories.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => {
      s.reactions[r.type] = r.count;
    });
  });

  const totalCount = db.prepare(`SELECT COUNT(*) as count FROM stories s ${where}`).get(...params).count;
  const totalPages = Math.ceil(totalCount / perPage);
  const hasMore = page < totalPages;

  const totalStats = db.prepare('SELECT value FROM site_stats WHERE key = ?').get('total_views');
  const submissionCount = db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 1').get();
  const totalReactions = db.prepare('SELECT SUM(count) as total FROM reactions').get();

  const featured = db.prepare(`
    SELECT s.*, SUM(r.count) as total_reacts FROM stories s
    LEFT JOIN reactions r ON s.id = r.story_id
    WHERE s.approved = 1 AND s.featured = 1 GROUP BY s.id
  `).get();

  // Category counts
  const categoryCounts = {};
  CATEGORIES().forEach(c => {
    categoryCounts[c.name] = db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 1 AND category = ?').get(c.name).count;
  });

  res.render('index', {
    stories, categories: CATEGORIES(), categoryCounts,
    totalViews: totalStats?.value || 0,
    totalStories: submissionCount.count,
    totalReactions: totalReactions?.total || 0,
    featured,
    currentPage: page, totalPages, hasMore,
    sort, category, search,
    allowImageUpload: getSetting('allow_image_upload') === '1',
    adsenseHeader: getSetting('adsense_header'),
    adsenseFooter: getSetting('adsense_footer'),
    customHeadCode: getSetting('custom_head_code'),
    weeklyQuestion: getSetting('weekly_question'),
    title: 'أول مرّة - تجارب الناس',
    description: 'شارك تجربتك - أشياء ندمت عليها وأشياء تمنيت لو فعلتها'
  });
});

// Story detail
app.get('/story/:id', (req, res) => {
  const story = db.prepare(`
    SELECT * FROM stories WHERE id = ? AND approved = 1
  `).get(req.params.id);

  if (!story) return res.status(404).render('404');

  db.prepare('UPDATE stories SET views = views + 1 WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE site_stats SET value = value + 1 WHERE key = ?').run('total_views');
  story.views++;

  const comments = db.prepare('SELECT * FROM comments WHERE story_id = ? AND approved = 1 AND parent_id IS NULL ORDER BY created_at DESC').all(story.id);
  // Attach votes to comments
  comments.forEach(c => {
    const voteRow = db.prepare('SELECT SUM(vote_type) as total FROM votes WHERE comment_id = ?').get(c.id);
    c.voteTotal = voteRow?.total || 0;
    const replies = db.prepare('SELECT * FROM comments WHERE parent_id = ? AND approved = 1 ORDER BY created_at ASC').all(c.id);
    replies.forEach(r => {
      const rv = db.prepare('SELECT SUM(vote_type) as total FROM votes WHERE comment_id = ?').get(r.id);
      r.voteTotal = rv?.total || 0;
    });
    c.replies = replies;
  });

  // Related stories (same category, exclude current)
  const related = db.prepare(`
    SELECT *, (SELECT COUNT(*) FROM comments WHERE story_id = id AND approved = 1) as comment_count FROM stories WHERE approved = 1 AND category = ? AND id != ? ORDER BY created_at DESC LIMIT 4
  `).all(story.category, story.id);

  // Attach reactions to related
  related.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => {
      s.reactions[r.type] = r.count;
    });
  });

  // Popular stories for 404
  const popular = db.prepare('SELECT * FROM stories WHERE approved = 1 ORDER BY views DESC LIMIT 5').all();

  // Reading time estimate
  const allText = (story.done_regrets || '') + (story.notdone_regrets || '') + (story.comment || '');
  const wordCount = allText.split(/[\s|||]+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  res.render('story', {
    story, comments, related, popular, readingTime,
    title: `تجربة ${story.hide_name ? 'مجهول' : story.name} - أول مرّة`,
    description: `اقرأ تجربة ${story.hide_name ? 'مجهول' : story.name} على أول مرّة`,
    canonical: `https://awwal-time.ksawats.com/story/${story.id}`,
    ogImage: `https://awwal-time.ksawats.com/og-image/${story.id}`
  });
});

// React to story
app.post('/story/:id/react', (req, res) => {
  const { type } = req.body;
  const storyId = req.params.id;
  if (!['relatable', 'sympathy', 'motivated'].includes(type)) return res.json({error:'invalid'});
  db.prepare('INSERT INTO reactions (story_id, type, count) VALUES (?, ?, 1) ON CONFLICT(story_id, type) DO UPDATE SET count = count + 1').run(storyId, type);
  res.json({ok:true});
});

// Submit page
app.get('/submit', (req, res) => {
  res.render('submit', {
    title: 'شارك تجربتك - أول مرّة',
    description: 'شاركنا أشياء ندمت عليها وأشياء تمنيت لو فعلتها',
    categories: CATEGORIES(),
    allowImageUpload: getSetting('allow_image_upload') === '1'
  });
});
app.use((req, res, next) => {
  req.xhr = req.headers['x-requested-with'] === 'XMLHttpRequest';
  next();
});

app.post('/submit', (req, res, next) => {
  if (getSetting('allow_image_upload') === '1') {
    upload.single('image')(req, res, next);
  } else {
    next();
  }
}, (req, res) => {
  const { name, email, hide_name, category, done1, done2, done3, done4, done5,
          notdone1, notdone2, notdone3, notdone4, notdone5, comment, simple_mode, simple_text } = req.body;

  let done_regrets, notdone_regrets, finalComment, finalCategory;
  
  if (simple_mode === '1' && simple_text) {
    // Simple mode: put everything in comment
    done_regrets = '';
    notdone_regrets = '';
    finalComment = simple_text;
    finalCategory = 'شخصي';
  } else {
    done_regrets = [done1, done2, done3, done4, done5].filter(Boolean).join('|||');
    notdone_regrets = [notdone1, notdone2, notdone3, notdone4, notdone5].filter(Boolean).join('|||');
    finalComment = comment || '';
    finalCategory = category || 'شخصي';
  }

  // Validation
  if (simple_mode === '1') {
    if (!name || !simple_text) {
      if (req.xhr || req.headers.accept === 'application/json') {
        return res.status(400).json({ error: 'يرجى ملء الحقول المطلوبة' });
      }
      return res.render('submit', { error: 'يرجى ملء الحقول المطلوبة', title: 'شارك تجربتك', categories: CATEGORIES() });
    }
  } else {
    if (!name || (!done_regrets && !notdone_regrets)) {
      if (req.xhr || req.headers.accept === 'application/json') {
        return res.status(400).json({ error: 'يرجى ملء الحقول المطلوبة' });
      }
      return res.render('submit', { error: 'يرجى ملء الحقول المطلوبة', title: 'شارك تجربتك', categories: CATEGORIES() });
    }
  }

  const image_url = (getSetting('allow_image_upload') === '1' && req.file) ? 'uploads/' + req.file.filename : null;
  const userId = getUserId(req, res);
  const stmt = db.prepare(`
    INSERT INTO stories (name, hide_name, email, done_regrets, notdone_regrets, comment, category, user_id, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(name, hide_name ? 1 : 0, email || null, done_regrets, notdone_regrets, finalComment, finalCategory, userId, image_url);

  if (getSetting('require_approval') !== '1') {
    const lastId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    db.prepare('UPDATE stories SET approved = 1 WHERE id = ?').run(lastId);
  }

  if (email) {
    try { db.prepare('INSERT OR IGNORE INTO emails (email, source) VALUES (?, ?)').run(email, 'submission'); } catch {}
  }

  db.prepare('UPDATE site_stats SET value = value + 1 WHERE key = ?').run('total_submissions');
  const newStoryId = db.prepare('SELECT last_insert_rowid() as id').get().id;
  fireWebhook('story.created', { id: newStoryId, name, category: finalCategory });
  
  // If AJAX/modal submit, return JSON
  if (req.xhr || req.headers.accept === 'application/json') {
    return res.json({ ok: true, id: newStoryId });
  }
  res.render('submit-success', { title: 'تم الإرسال بنجاح - أول مرّة' });
});

// Privacy Policy
app.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'سياسة الخصوصية - أول مرّة' });
});

// Contact
app.get('/contact', (req, res) => {
  res.render('contact', { title: 'تواصل معنا - أول مرّة' });
});

app.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.render('contact', { error: 'يرجى ملء جميع الحقول المطلوبة', title: 'تواصل معنا - أول مرّة' });
  }
  db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(name, email, subject || '', message);
  logActivity('رسالة تواصل', `من: ${name} (${email})`);
  res.render('contact', { success: 'تم إرسال رسالتك بنجاح! سنرد عليك في أقرب وقت.', title: 'تواصل معنا - أول مرّة' });
});

// Newsletter
app.post('/newsletter', (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ error: 'الإيميل مطلوب' });
  try {
    db.prepare('INSERT OR IGNORE INTO emails (email, source) VALUES (?, ?)').run(email, 'newsletter');
    res.json({ success: true });
  } catch {
    res.json({ error: 'حدث خطأ' });
  }
});

// Activity log table
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    UNIQUE(story_id, type),
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
  );
`);

function logActivity(action, details) {
  db.prepare('INSERT INTO activity_log (action, details) VALUES (?, ?)').run(action, details || '');
}

// ============ ADMIN ROUTES ============

app.get('/admin/login', (req, res) => {
  if (req.cookies.admin_token) return res.redirect('/admin');
  res.render('admin/login', { layout: 'admin/layout', title: 'تسجيل دخول - أول مرّة' });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

  if (admin && bcrypt.compareSync(password, admin.password)) {
    logActivity('تسجيل دخول', `المستخدم: ${username}`);
    auditLog('تسجيل دخول', username, 'تسجيل دخول ناجح', req.ip);
    res.cookie('admin_token', Buffer.from('admin_session').toString('base64'), {
      httpOnly: true, maxAge: 86400000
    });
    res.cookie('admin_session_user', Buffer.from(username).toString('base64'), {
      httpOnly: true, maxAge: 86400000
    });
    return res.redirect('/admin');
  }

  res.render('admin/login', { layout: 'admin/layout', error: 'بيانات خاطئة', title: 'تسجيل دخول' });
});

app.get('/admin/logout', (req, res) => {
  const username = getAdminUsername(req);
  logActivity('تسجيل خروج');
  auditLog('تسجيل خروج', username, '', req.ip);
  res.clearCookie('admin_token');
  res.clearCookie('admin_session_user');
  res.redirect('/admin/login');
});

// 1. Dashboard
app.get('/admin', requireAuth, (req, res) => {
  const pending = db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 0').get();
  const approved = db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 1').get();
  const total = db.prepare('SELECT COUNT(*) as count FROM stories').get();
  const emailCount = db.prepare('SELECT COUNT(*) as count FROM emails').get();
  const stats = db.prepare('SELECT * FROM site_stats').all();

  const filter = req.query.filter || 'all';
  const search = req.query.search || '';
  let query = 'SELECT * FROM stories';
  const params = [];

  if (search) {
    query += ' WHERE (name LIKE ? OR comment LIKE ? OR done_regrets LIKE ? OR notdone_regrets LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (filter === 'pending') query += (params.length ? ' AND' : ' WHERE') + ' approved = 0';
  else if (filter === 'approved') query += (params.length ? ' AND' : ' WHERE') + ' approved = 1';

  query += ' ORDER BY created_at DESC LIMIT 50';

  const stories = db.prepare(query).all(...params);

  res.render('admin/dashboard', {
    layout: 'admin/layout',
    pending: pending.count, approved: approved.count, total: total.count,
    emails: emailCount.count, stories, stats,
    filter, search,
    title: 'لوحة التحكم - أول مرّة'
  });
});

// 2. Settings
app.get('/admin/settings', requireSuper, (req, res) => {
  res.render('admin/settings', {
    layout: 'admin/layout',
    requireApproval: getSetting('require_approval') === '1',
    adsenseHeader: getSetting('adsense_header'),
    adsenseFooter: getSetting('adsense_footer'),
    siteName: getSetting('site_name') || 'أول مرّة',
    siteDescription: getSetting('site_description') || '',
    emailEnabled: getSetting('email_enabled') === '1',
    mailHost: getSetting('mail_host'),
    mailPort: getSetting('mail_port') || '587',
    mailUser: getSetting('mail_user'),
    mailPass: getSetting('mail_pass'),
    mailFrom: getSetting('mail_from'),
    weeklyQuestion: getSetting('weekly_question'),
    customHeadCode: getSetting('custom_head_code'),
    features: getFeatureSettings(),
    allCategories: ALL_CATEGORIES(),
    cacheEntries: cache.stats(),
    commentsMode: getSetting('comments_mode') || 'open',
    dateFormat: getSetting('date_format') || 'gregorian',
    title: 'الإعدادات - أول مرّة'
  });
});

app.post('/admin/settings', requireSuper, (req, res) => {
  const { require_approval, adsense_header, adsense_footer, site_name, site_description,
          email_enabled, mail_host, mail_port, mail_user, mail_pass, mail_from, weekly_question,
          show_categories, show_advanced_submit, show_separate_regrets, show_leaderboard,
          show_compare, show_stats_page, show_weekly_question, show_related_stories } = req.body;
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'require_approval'").run(require_approval === 'on' ? '1' : '0');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'adsense_header'").run(adsense_header || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'adsense_footer'").run(adsense_footer || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'custom_head_code'").run(req.body.custom_head_code || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'site_name'").run(site_name || 'أول مرّة');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'site_description'").run(site_description || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'email_enabled'").run(email_enabled === 'on' ? '1' : '0');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'mail_host'").run(mail_host || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'mail_port'").run(mail_port || '587');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'mail_user'").run(mail_user || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'mail_pass'").run(mail_pass || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'mail_from'").run(mail_from || '');
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'weekly_question'").run(weekly_question || '');
  // Feature toggles
  ['show_categories','show_advanced_submit','show_separate_regrets','show_leaderboard','show_compare','show_stats_page','show_weekly_question','show_related_stories','show_search','allow_image_upload'].forEach(key => {
    db.prepare("UPDATE site_settings SET value = ? WHERE key = ?").run(req.body[key] === 'on' ? '1' : '0', key);
  });
  // Comments mode
  if (req.body.comments_mode) {
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('comments_mode', ?)").run(req.body.comments_mode);
  }
  if (req.body.date_format) {
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('date_format', ?)").run(req.body.date_format);
  }
  logWithAudit(req, 'تحديث الإعدادات', 'تم تحديث إعدادات الموقع');
  res.redirect('/admin/settings');
});

// Category management API
app.post('/admin/categories/add', requireSuper, (req, res) => {
  const { name, icon, color } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/settings');
  try {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),-1) + 1 as next FROM categories').get();
    db.prepare('INSERT INTO categories (name, icon, color, active, sort_order) VALUES (?, ?, ?, 1, ?)').run(name.trim(), icon || '🌟', color || 'brand', maxSort.next);
    logWithAudit(req, 'إضافة تصنيف', `تمت إضافة التصنيف: ${name}`);
  } catch(e) { /* duplicate name */ }
  res.redirect('/admin/settings');
});

app.post('/admin/categories/toggle/:id', requireSuper, (req, res) => {
  db.prepare('UPDATE categories SET active = NOT active WHERE id = ?').run(req.params.id);
  logWithAudit(req, 'تبديل تصنيف', `تم تبديل حالة التصنيف #${req.params.id}`);
  res.redirect('/admin/settings');
});

app.post('/admin/categories/delete/:id', requireSuper, (req, res) => {
  const cat = db.prepare('SELECT name FROM categories WHERE id = ?').get(req.params.id);
  if (cat) {
    // Move stories to 'شخصي' before deleting
    db.prepare('UPDATE stories SET category = ? WHERE category = ?').run('شخصي', cat.name);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    logWithAudit(req, 'حذف تصنيف', `تم حذف التصنيف: ${cat.name}`);
  }
  res.redirect('/admin/settings');
});
app.post('/admin/story/:id/approve', requireModerator, (req, res) => {
  db.prepare('UPDATE stories SET approved = 1 WHERE id = ?').run(req.params.id);
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  queueNotification('new_story', { storyId: story.id, storyName: story.name });
  logWithAudit(req, 'موافقة على تجربة', `رقم: ${req.params.id}`);
  invalidateCache('homepage');
  fireWebhook('story.approved', { id: parseInt(req.params.id), name: story.name, category: story.category });
  res.redirect('/admin');
});

app.post('/admin/story/:id/delete', requireModerator, (req, res) => {
  logWithAudit(req, 'حذف تجربة', `رقم: ${req.params.id}`);
  db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// 4. Statistics
app.get('/admin/stats', requireAuth, (req, res) => {
  const totalStories = db.prepare('SELECT COUNT(*) as count FROM stories').get().count;
  const approvedStories = db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 1').get().count;
  const pendingStories = db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 0').get().count;
  const totalEmails = db.prepare('SELECT COUNT(*) as count FROM emails').get().count;
  const totalViews = db.prepare("SELECT value FROM site_stats WHERE key = 'total_views'").get()?.value || 0;
  const totalSubmissions = db.prepare("SELECT value FROM site_stats WHERE key = 'total_submissions'").get()?.value || 0;
  const avgViews = totalStories > 0 ? (db.prepare('SELECT AVG(views) as avg FROM stories WHERE approved = 1').get().avg || 0).toFixed(1) : 0;
  const topStory = db.prepare('SELECT id, name, hide_name, views FROM stories WHERE approved = 1 ORDER BY views DESC LIMIT 1').get();

  const dailyStats = db.prepare(`SELECT DATE(created_at) as date, COUNT(*) as count FROM stories GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`).all().reverse();
  const dailyViews = db.prepare(`SELECT DATE(created_at) as date, SUM(views) as total FROM stories WHERE approved = 1 GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`).all().reverse();
  const categoryDist = CATEGORIES().map(c => ({ name: c.name, icon: c.icon, count: db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 1 AND category = ?').get(c.name).count }));
  const emailSources = db.prepare('SELECT source, COUNT(*) as count FROM emails GROUP BY source').all();
  const allDone = db.prepare("SELECT done_regrets FROM stories WHERE approved = 1 AND done_regrets != ''").all();
  const allNotDone = db.prepare("SELECT notdone_regrets FROM stories WHERE approved = 1 AND notdone_regrets != ''").all();

  res.render('admin/stats', {
    layout: 'admin/layout',
    totalStories, approvedStories, pendingStories, totalEmails,
    totalViews, totalSubmissions, avgViews, topStory,
    dailyStats, dailyViews, categoryDist, emailSources,
    totalDoneItems: allDone.reduce((sum, r) => sum + r.done_regrets.split('|||').filter(Boolean).length, 0),
    totalNotDoneItems: allNotDone.reduce((sum, r) => sum + r.notdone_regrets.split('|||').filter(Boolean).length, 0),
    title: 'الإحصائيات - أول مرّة'
  });
});

// 5. Edit story
app.get('/admin/story/:id/edit', requireModerator, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.redirect('/admin');

  const doneItems = (story.done_regrets || '').split('|||').filter(Boolean);
  const notDoneItems = (story.notdone_regrets || '').split('|||').filter(Boolean);

  res.render('admin/edit-story', {
    layout: 'admin/layout', story, doneItems, notDoneItems,
    title: 'تعديل تجربة - أول مرّة'
  });
});

app.post('/admin/story/:id/edit', requireModerator, (req, res) => {
  const { name, email, hide_name, done_regrets, notdone_regrets, comment, approved } = req.body;
  db.prepare(`
    UPDATE stories SET name=?, email=?, hide_name=?, done_regrets=?, notdone_regrets=?, comment=?, approved=?
    WHERE id=?
  `).run(name, email || null, hide_name ? 1 : 0, done_regrets || '', notdone_regrets || '', comment || '', approved === 'on' ? 1 : 0, req.params.id);
  logWithAudit(req, 'تعديل تجربة', `رقم: ${req.params.id}`);
  res.redirect('/admin');
});

// 6. Export data
app.get('/admin/export', requireModerator, (req, res) => {
  const format = req.query.format || 'csv';
  const type = req.query.type || 'stories';

  if (type === 'emails') {
    const data = db.prepare('SELECT * FROM emails ORDER BY created_at DESC').all();
    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=emails.json');
      res.json(data);
    } else {
      let csv = 'الرقم,الإيميل,المصدر,التاريخ\n';
      data.forEach(r => { csv += `${r.id},"${r.email}",${r.source},${r.created_at}\n`; });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=emails.csv');
      res.send('\uFEFF' + csv);
    }
  } else {
    const data = db.prepare('SELECT * FROM stories ORDER BY created_at DESC').all();
    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=stories.json');
      res.json(data);
    } else {
      let csv = 'الرقم,الاسم,مخفي,إيميل,ندم عليها,تمنى لو فعلها,تعليق,منشورة,مشاهدات,مشاركات,التاريخ\n';
      data.forEach(r => {
        csv += `${r.id},"${r.name}",${r.hide_name},"${r.email || ''}","${(r.done_regrets||'').replace(/"/g,'""')}","${(r.notdone_regrets||'').replace(/"/g,'""')}","${(r.comment||'').replace(/"/g,'""')}",${r.approved},${r.views},${r.shares},${r.created_at}\n`;
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=stories.csv');
      res.send('\uFEFF' + csv);
    }
  }
  logWithAudit(req, 'تصدير بيانات', `${type} (${format})`);
});

// 7. Bulk actions
app.post('/admin/bulk', requireModerator, (req, res) => {
  const { action, ids } = req.body;
  const idList = (ids || '').split(',').map(Number).filter(Boolean);

  if (idList.length === 0) return res.redirect('/admin');

  if (action === 'approve_all') {
    const placeholders = idList.map(() => '?').join(',');
    db.prepare(`UPDATE stories SET approved = 1 WHERE id IN (${placeholders})`).run(...idList);
    logWithAudit(req, 'موافقة جماعية', `${idList.length} تجربة`);
  } else if (action === 'delete_all') {
    const placeholders = idList.map(() => '?').join(',');
    db.prepare(`DELETE FROM stories WHERE id IN (${placeholders})`).run(...idList);
    logWithAudit(req, 'حذف جماعي', `${idList.length} تجربة`);
  }

  res.redirect('/admin');
});

// 8. Account management
app.get('/admin/account', requireSuper, (req, res) => {
  const admins = db.prepare('SELECT id, username, role FROM admins').all();
  const currentUser = getAdminUsername(req);
  const currentRole = db.prepare('SELECT role FROM admins WHERE username = ?').get(currentUser);
  res.render('admin/account', {
    layout: 'admin/layout', admins, currentUser, currentRole,
    title: 'إدارة الحساب - أول مرّة'
  });
});

app.post('/admin/account/password', requireSuper, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const admin = db.prepare('SELECT * FROM admins LIMIT 1').get();

  if (!bcrypt.compareSync(current_password, admin.password)) {
    return res.render('admin/account', {
      layout: 'admin/layout', admins,
      error: 'كلمة المرور الحالية خاطئة',
      title: 'إدارة الحساب - أول مرّة'
    });
  }

  if (new_password.length < 6) {
    return res.render('admin/account', {
      layout: 'admin/layout', admins,
      error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل',
      title: 'إدارة الحساب - أول مرّة'
    });
  }

  if (new_password !== confirm_password) {
    return res.render('admin/account', {
      layout: 'admin/layout', admins,
      error: 'كلمة المرور الجديدة غير متطابقة',
      title: 'إدارة الحساب - أول مرّة'
    });
  }

  db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), admin.id);
  logWithAudit(req, 'تغيير كلمة المرور', '');
  const admins2 = db.prepare('SELECT id, username, role FROM admins').all();
  const currentUser2 = getAdminUsername(req);
  const currentRole2 = db.prepare('SELECT role FROM admins WHERE username = ?').get(currentUser2);
  res.render('admin/account', {
    layout: 'admin/layout', admins: admins2, currentUser: currentUser2, currentRole: currentRole2,
    success: 'تم تغيير كلمة المرور بنجاح',
    title: 'إدارة الحساب - أول مرّة'
  });
});

// 9. Activity log
app.get('/admin/activity', requireSuper, (req, res) => {
  const logs = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 200').all();
  res.render('admin/activity', {
    layout: 'admin/layout', logs,
    title: 'سجل النشاط - أول مرّة'
  });
});

app.post('/admin/activity/clear', requireSuper, (req, res) => {
  db.prepare('DELETE FROM activity_log').run();
  res.redirect('/admin/activity');
});

// 10. Emails
app.get('/admin/emails', requireModerator, (req, res) => {
  const emails = db.prepare('SELECT * FROM emails ORDER BY created_at DESC').all();
  res.render('admin/emails', { layout: 'admin/layout', emails, title: 'الإيميلات - أول مرّة' });
});

app.post('/admin/emails/delete/:id', requireModerator, (req, res) => {
  db.prepare('DELETE FROM emails WHERE id = ?').run(req.params.id);
  res.redirect('/admin/emails');
});

// Comments (with reply support)
app.post('/story/:id/comment', (req, res) => {
  const commentsMode = getSetting('comments_mode');
  if (commentsMode === 'disabled') return res.json({ error: 'التعليقات معطلة حالياً' });
  const { name, email, comment, parent_id } = req.body;
  if (!name || !comment) return res.json({ error: 'الاسم والتعليق مطلوبان' });
  const userId = getUserId(req, res);
  const approved = commentsMode === 'open' ? 1 : 0;
  db.prepare('INSERT INTO comments (story_id, name, email, comment, parent_id, user_id, approved) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.params.id, name, email || null, comment, parent_id || null, userId, approved);
  invalidateCache('homepage');
  fireWebhook('comment.added', { storyId: parseInt(req.params.id), commentName: name });
  res.json({ ok: true });
});

// Vote on comment
app.post('/comment/:id/vote', (req, res) => {
  const { type } = req.body;
  const commentId = req.params.id;
  const ip = req.ip;
  if (!['up', 'down'].includes(type)) return res.json({ error: 'invalid' });
  const existing = db.prepare('SELECT * FROM votes WHERE comment_id = ? AND ip = ?').get(commentId, ip);
  if (existing) {
    if (existing.vote_type === (type === 'up' ? 1 : -1)) {
      db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
      return res.json({ ok: true, removed: true });
    }
    db.prepare('UPDATE votes SET vote_type = ? WHERE id = ?').run(type === 'up' ? 1 : -1, existing.id);
    return res.json({ ok: true, changed: true });
  }
  db.prepare('INSERT INTO votes (comment_id, vote_type, ip) VALUES (?, ?, ?)').run(commentId, type === 'up' ? 1 : -1, ip);
  res.json({ ok: true });
});

// Report story
app.post('/story/:id/report', (req, res) => {
  const { reason } = req.body;
  db.prepare('INSERT INTO reports (story_id, reason) VALUES (?, ?)').run(req.params.id, reason || 'غير محدد');
  logActivity('إبلاغ عن تجربة', `رقم: ${req.params.id}، السبب: ${reason || 'غير محدد'}`);
  res.json({ ok: true });
});

// Report comment
app.post('/comment/:id/report', (req, res) => {
  const { reason, story_id } = req.body;
  db.prepare('INSERT INTO reports (comment_id, story_id, reason) VALUES (?, ?, ?)').run(req.params.id, story_id || null, reason || 'غير محدد');
  logActivity('إبلاغ عن تعليق', `رقم: ${req.params.id}`);
  res.json({ ok: true });
});

// Favorites page
app.get('/favorites', (req, res) => {
  res.render('favorites', {
    title: 'المفضلة - أول مرّة',
    description: 'التجارب المفضلة لديك'
  });
});

// API for favorites data
app.post('/api/favorites', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.json([]);
  const placeholders = ids.map(() => '?').join(',');
  const stories = db.prepare(`SELECT * FROM stories WHERE id IN (${placeholders}) AND approved = 1 ORDER BY created_at DESC`).all(...ids);
  stories.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => {
      s.reactions[r.type] = r.count;
    });
  });
  res.json(stories);
});

// Admin Comments - with nested replies and admin quick reply
app.get('/admin/comments', requireModerator, (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, s.name as story_name FROM comments c
    LEFT JOIN stories s ON c.story_id = s.id
    WHERE c.parent_id IS NULL
    ORDER BY c.created_at DESC LIMIT 200
  `).all();
  // Attach replies for each comment
  comments.forEach(c => {
    c.replies = db.prepare(`
      SELECT * FROM comments WHERE parent_id = ? ORDER BY created_at ASC
    `).all(c.id);
  });
  res.render('admin/comments', { layout: 'admin/layout', comments, title: 'التعليقات - أول مرّة' });
});

app.post('/admin/comment/:id/delete', requireModerator, (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  logWithAudit(req, 'حذف تعليق', `رقم: ${req.params.id}`);
  res.redirect('/admin/comments');
});

app.post('/admin/comment/:id/toggle', requireModerator, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (comment) db.prepare('UPDATE comments SET approved = ? WHERE id = ?').run(comment.approved ? 0 : 1, req.params.id);
  res.redirect('/admin/comments');
});

// Admin Messages
app.get('/admin/messages', requireModerator, (req, res) => {
  const messages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 200').all();
  const unread = db.prepare('SELECT COUNT(*) as count FROM contact_messages WHERE is_read = 0').get().count;
  res.render('admin/messages', { layout: 'admin/layout', messages, unread, title: 'الرسائل - أول مرّة' });
});

app.post('/admin/message/:id/read', requireModerator, (req, res) => {
  db.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/messages');
});

app.post('/admin/message/:id/delete', requireModerator, (req, res) => {
  db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  logWithAudit(req, 'حذف رسالة تواصل', `رقم: ${req.params.id}`);
  res.redirect('/admin/messages');
});

// ============ FEATURE ROUTES (6-10) ============

const { v4: uuidv4 } = require('crypto').randomUUID ? { v4: () => require('crypto').randomUUID() } : (() => { try { return require('uuid'); } catch { return { v4: () => require('crypto').randomUUID() }; } })();
function getUserId(req, res) {
  let uid = req.cookies.user_id;
  if (!uid) { uid = require('crypto').randomUUID(); res.cookie('user_id', uid, { maxAge: 365*86400000, httpOnly: true }); }
  return uid;
}

// 6. Leaderboard
app.get('/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.hide_name, s.category, s.views, s.created_at,
      COALESCE((SELECT SUM(r.count) FROM reactions r WHERE r.story_id = s.id), 0) as total_reacts,
      (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id AND c.approved = 1) as comment_count
    FROM stories s WHERE s.approved = 1
    ORDER BY (s.views + COALESCE((SELECT SUM(r.count) FROM reactions r WHERE r.story_id = s.id), 0)*5 + (SELECT COUNT(*) FROM comments c WHERE c.story_id = s.id AND c.approved = 1)*3) DESC
    LIMIT 10
  `).all();
  rows.forEach(r => { r.score = r.views + r.total_reacts*5 + r.comment_count*3; });
  const badges = ['🥇','🥈','🥉'];
  res.render('leaderboard', { rows, badges, title: '🏆 المتصدرين - أول مرّة', description: 'أكثر 10 تجارب تفاعلاً على أول مرّة' });
});

// 7. My Stats
app.get('/my-stats', (req, res) => {
  const uid = req.cookies.user_id;
  if (!uid) return res.render('my-stats', { uid: null, stats: null, title: 'إحصائياتي - أول مرّة', description: 'إحصائياتك الشخصية على أول مرّة' });
  const storiesCount = db.prepare('SELECT COUNT(*) as c FROM stories WHERE user_id = ?').get(uid).c;
  const commentsCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ?').get(uid).c;
  const totalReactions = db.prepare(`
    SELECT COALESCE(SUM(r.count),0) as t FROM reactions r JOIN stories s ON r.story_id = s.id WHERE s.user_id = ?
  `).get(uid).t;
  const totalViews = db.prepare('SELECT COALESCE(SUM(views),0) as t FROM stories WHERE user_id = ?').get(uid).t;
  const myStories = db.prepare('SELECT id, name, hide_name, views, created_at FROM stories WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(uid);
  res.render('my-stats', { uid, stats: { storiesCount, commentsCount, totalReactions, totalViews }, myStories, title: 'إحصائياتي - أول مرّة', description: 'إحصائياتك الشخصية على أول مرّة' });
});

// 8. Sitemap
app.get('/sitemap.xml', (req, res) => {
  const baseUrl = process.env.SITE_URL || 'https://awwal-time.ksawats.com';
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  const staticPages = ['','/submit','/privacy','/contact','/leaderboard','/my-stats','/best'];
  staticPages.forEach(p => { xml += `\n<url><loc>${baseUrl}${p}</loc><priority>${p===''?'1.0':'0.7'}</priority></url>`; });
  CATEGORIES().forEach(c => {
    const slug = encodeURIComponent(c.name);
    xml += `\n<url><loc>${baseUrl}/category/${slug}</loc><priority>0.8</priority></url>`;
  });
  const stories = db.prepare('SELECT id, created_at FROM stories WHERE approved = 1').all();
  stories.forEach(s => { xml += `\n<url><loc>${baseUrl}/story/${s.id}</loc><lastmod>${s.created_at.split(' ')[0]}</lastmod><priority>0.6</priority></url>`; });
  xml += '\n</urlset>';
  res.setHeader('Content-Type', 'application/xml').send(xml);
});

// 9. Category Pages
const CATEGORY_SLUGS = {};
CATEGORIES().forEach(c => { CATEGORY_SLUGS[c.name] = c; });

app.get('/category/:slug', (req, res) => {
  const catName = decodeURIComponent(req.params.slug);
  const cat = CATEGORY_SLUGS[catName];
  if (!cat) return res.status(404).render('404', { title: 'التصنيف غير موجود' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 10;
  const offset = (page - 1) * perPage;
  const stories = db.prepare('SELECT * FROM stories WHERE approved = 1 AND category = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(catName, perPage, offset);
  const totalCount = db.prepare('SELECT COUNT(*) as c FROM stories WHERE approved = 1 AND category = ?').get(catName).c;
  const totalPages = Math.ceil(totalCount / perPage);

  stories.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => { s.reactions[r.type] = r.count; });
  });

  res.render('category', { cat, stories, currentPage: page, totalPages, totalCount,
    title: `${cat.icon} ${catName} - أول مرّة`, description: `تصفح تجارب التصنيف ${catName} على أول مرّة`,
    canonical: `https://awwal-time.ksawats.com/category/${encodeURIComponent(catName)}` });
});

// 10. Best Stories (Pinned)
app.get('/best', (req, res) => {
  const pinned = db.prepare('SELECT * FROM stories WHERE approved = 1 AND pinned = 1 ORDER BY created_at DESC').all();
  pinned.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => { s.reactions[r.type] = r.count; });
  });
  res.render('best', { stories: pinned, title: '⭐ أفضل التجارب - أول مرّة', description: 'تجارب مميزة انتقاها فريق أول مرّة' });
});

// Admin: Toggle pinned
app.post('/admin/story/:id/pin', requireModerator, (req, res) => {
  const story = db.prepare('SELECT pinned FROM stories WHERE id = ?').get(req.params.id);
  if (story) {
    db.prepare('UPDATE stories SET pinned = ? WHERE id = ?').run(story.pinned ? 0 : 1, req.params.id);
    logWithAudit(req, 'تثبيت/إلغاء تجربة', `رقم: ${req.params.id}`);
  }
  res.redirect('back');
});

// 11. RSS Feed
app.get('/rss', (req, res) => {
  const stories = db.prepare('SELECT * FROM stories WHERE approved = 1 ORDER BY created_at DESC LIMIT 20').all();
  const baseUrl = process.env.BASE_URL || 'https://awwal-time.ksawats.com';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  const items = stories.map(s => `
    <item>
      <title><![CDATA[تجربة ${s.hide_name ? 'مجهول' : s.name} - أول مرّة]]></title>
      <description><![CDATA[<p>${(s.done_regrets||'').split('|||').filter(Boolean).map(i=>`😔 ${i}`).join('<br>')}</p><p>${(s.notdone_regrets||'').split('|||').filter(Boolean).map(i=>`✨ ${i}`).join('<br>')}</p>${s.comment ? '<p>'+s.comment+'</p>' : ''}]]></description>
      <link>${baseUrl}/story/${s.id}</link>
      <guid>${baseUrl}/story/${s.id}</guid>
      <pubDate>${new Date(s.created_at).toUTCString()}</pubDate>
      ${s.image_url ? '<image>'+baseUrl+'/'+s.image_url+'</image>' : ''}
    </item>`).join('');

  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" dir="rtl">
  <channel>
    <title>أول مرّة - تجارب الناس</title>
    <link>${baseUrl}</link>
    <description>شارك تجربتك - أشياء ندمت عليها وأشياء تمنيت لو فعلتها</description>
    <language>ar</language>
    <atom:link href="${baseUrl}/rss" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`);
});

// 12. OG Image (SVG-based)
app.get('/og-image/:id', (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ? AND approved = 1').get(req.params.id);
  if (!story) return res.status(404).send('Not found');

  const title = (story.hide_name ? 'مجهول' : story.name).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const category = (story.category || 'شخصي').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const excerpt = ((story.done_regrets || '').split('|||').filter(Boolean)[0] || '').slice(0, 80);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f172a"/>
      <stop offset="100%" style="stop-color:#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" rx="0"/>
  <rect x="0" y="0" width="1200" height="6" fill="#ef4444"/>
  <text x="600" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="bold" fill="#f1f5f9">أول مرّة</text>
  <text x="600" y="240" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#94a3b8">تجربة ${title}</text>
  <text x="600" y="300" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#64748b">${excerpt}</text>
  <rect x="480" y="340" width="240" height="36" rx="18" fill="#dc2626" opacity="0.2"/>
  <text x="600" y="365" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#f87171">${category}</text>
  <text x="600" y="440" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#475569">awwal-time.ksawats.com</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});

// 15. Advanced Search
app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const category = req.query.category || '';
  const sort = req.query.sort || 'latest';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 10;
  const offset = (page - 1) * perPage;

  let where = 'WHERE s.approved = 1';
  const params = [];

  if (q) {
    where += ' AND (s.name LIKE ? OR s.done_regrets LIKE ? OR s.notdone_regrets LIKE ? OR s.comment LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term, term, term);
  }
  if (category) {
    where += ' AND s.category = ?';
    params.push(category);
  }

  let order = 'ORDER BY s.created_at DESC';
  if (sort === 'views') order = 'ORDER BY s.views DESC';
  else if (sort === 'oldest') order = 'ORDER BY s.created_at ASC';

  const stories = db.prepare(`
    SELECT s.*, (SELECT SUM(r.count) FROM reactions r WHERE r.story_id = s.id) as total_reacts
    FROM stories s ${where} ${order} LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  stories.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => {
      s.reactions[r.type] = r.count;
    });
  });

  const totalCount = db.prepare(`SELECT COUNT(*) as count FROM stories s ${where}`).get(...params).count;
  const totalPages = Math.ceil(totalCount / perPage);

  // Highlight function
  function highlight(text, term) {
    if (!term || !text) return text;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-yellow-500/30 text-yellow-300 rounded px-0.5">$1</mark>');
  }

  res.render('search', {
    stories, categories: CATEGORIES(), q, category, sort,
    highlight, totalCount, currentPage: page, totalPages,
    title: q ? `نتائج البحث عن "${q}" - أول مرّة` : 'البحث - أول مرّة',
    description: 'ابحث في تجارب الناس على أول مرّة'
  });
});

// Toggle featured
app.post('/admin/story/:id/featured', requireModerator, (req, res) => {
  const story = db.prepare('SELECT featured FROM stories WHERE id = ?').get(req.params.id);
  if (story) {
    const newFeatured = story.featured ? 0 : 1;
    // Only one featured at a time
    if (newFeatured) db.prepare('UPDATE stories SET featured = 0').run();
    db.prepare('UPDATE stories SET featured = ? WHERE id = ?').run(newFeatured, req.params.id);
    logWithAudit(req, newFeatured ? 'تعيين تجربة مميزة' : 'إزالة التمييز', `رقم: ${req.params.id}`);
  }
  res.redirect('/admin');
});

// Admin Reports
app.get('/admin/reports', requireModerator, (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, s.name as story_name, s.hide_name as story_hide_name,
           c.name as comment_name, c.comment as comment_text
    FROM reports r
    LEFT JOIN stories s ON r.story_id = s.id
    LEFT JOIN comments c ON r.comment_id = c.id
    ORDER BY r.created_at DESC LIMIT 200
  `).all();
  res.render('admin/reports', { layout: 'admin/layout', reports, title: 'البلاغات - أول مرّة' });
});

app.post('/admin/report/:id/delete', requireModerator, (req, res) => {
  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  logWithAudit(req, 'حذف بلاغ', `رقم: ${req.params.id}`);
  res.redirect('/admin/reports');
});

app.post('/admin/reports/clear', requireModerator, (req, res) => {
  db.prepare('DELETE FROM reports').run();
  logWithAudit(req, 'مسح جميع البلاغات', '');
  res.redirect('/admin/reports');
});

// ============ FEATURE 16: EMAIL NOTIFICATIONS ============

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Init email settings
settings.run('email_enabled', '0');
settings.run('mail_host', '');
settings.run('mail_port', '587');
settings.run('mail_user', '');
settings.run('mail_pass', '');
settings.run('mail_from', '');

function getMailer() {
  const host = getSetting('mail_host');
  const port = parseInt(getSetting('mail_port')) || 587;
  const user = getSetting('mail_user');
  const pass = getSetting('mail_pass');
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

function queueNotification(type, data) {
  db.prepare('INSERT INTO notifications (type, data) VALUES (?, ?)').run(type, JSON.stringify(data));
}

async function sendNotificationEmail(to, subject, html) {
  const mailer = getMailer();
  if (!mailer) return false;
  const from = getSetting('mail_from') || getSetting('mail_user');
  try {
    await mailer.sendMail({ from, to, subject, html });
    return true;
  } catch (e) {
    console.error('Email error:', e.message);
    return false;
  }
}

// Queue notification when story is approved (handled in route above)

// Notification queue admin
app.get('/admin/notifications', requireModerator, (req, res) => {
  const pending = db.prepare('SELECT * FROM notifications WHERE sent = 0 ORDER BY created_at DESC').all();
  const sent = db.prepare('SELECT * FROM notifications WHERE sent = 1 ORDER BY created_at DESC LIMIT 50').all();
  res.render('admin/notifications', { layout: 'admin/layout', pending, sent, title: 'الإشعارات - أول مرّة' });
});

app.post('/admin/notifications/:id/send', requireModerator, async (req, res) => {
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (notif) {
    const data = JSON.parse(notif.data);
    let sent = false;
    if (notif.type === 'new_story') {
      sent = await sendNotificationEmail(
        getSetting('mail_user'),
        'تجربة جديدة على أول مرّة',
        `<h2>تجربة جديدة</h2><p>تم نشر تجربة جديدة بعنوان: ${data.storyName}</p><p><a href="https://awwal-time.ksawats.com/story/${data.storyId}">اقرأ التجربة</a></p>`
      );
    }
    if (sent) db.prepare('UPDATE notifications SET sent = 1 WHERE id = ?').run(notif.id);
  }
  res.redirect('/admin/notifications');
});

// ============ FEATURE 17: CACHING SYSTEM ============

const cacheStore = new Map();

const cache = {
  get(key, ttlMs, fn) {
    const entry = cacheStore.get(key);
    if (entry && Date.now() - entry.time < ttlMs) return entry.value;
    const value = fn();
    cacheStore.set(key, { value, time: Date.now() });
    return value;
  },
  clear(pattern) {
    if (!pattern) { cacheStore.clear(); return; }
    for (const key of cacheStore.keys()) {
      if (key.includes(pattern)) cacheStore.delete(key);
    }
  },
  stats() {
    const entries = [];
    for (const [key, val] of cacheStore) {
      entries.push({ key, age: Math.round((Date.now() - val.time) / 1000) + 's' });
    }
    return entries;
  }
};

// Invalidate cache on mutations
function invalidateCache(pattern) { cache.clear(pattern); }

// ============ FEATURE 18: AUTO BACKUP ============

const backupsDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

app.get('/admin/backup', requireSuper, (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `awwal-backup-${timestamp}.json`;
  const tables = ['stories', 'emails', 'admins', 'site_stats', 'site_settings', 'comments', 'votes', 'reports', 'contact_messages', 'activity_log', 'reactions', 'notifications'];
  const backup = {};
  tables.forEach(t => {
    try { backup[t] = db.prepare(`SELECT * FROM ${t}`).all(); } catch {}
  });
  fs.writeFileSync(path.join(backupsDir, filename), JSON.stringify(backup, null, 2), 'utf-8');
  logWithAudit(req, 'نسخ احتياطي', filename);
  res.redirect('/admin/backup-list');
});

app.get('/admin/backup-list', requireSuper, (req, res) => {
  let files = [];
  try { files = fs.readdirSync(backupsDir).filter(f => f.endsWith('.json')).sort().reverse(); } catch {}
  res.render('admin/backups', { layout: 'admin/layout', files, title: 'النسخ الاحتياطية - أول مرّة' });
});

app.get('/admin/backup/download/:file', requireSuper, (req, res) => {
  const filepath = path.join(backupsDir, req.params.file);
  if (!fs.existsSync(filepath)) return res.status(404).send('Not found');
  res.download(filepath);
});

app.post('/admin/backup/delete/:file', requireSuper, (req, res) => {
  const filepath = path.join(backupsDir, req.params.file);
  try { fs.unlinkSync(filepath); } catch {}
  res.redirect('/admin/backup-list');
});

// ============ FEATURE 19: EMBED WIDGET ============

app.get('/embed', (req, res) => {
  const count = Math.min(20, Math.max(1, parseInt(req.query.count) || 5));
  const category = req.query.category || '';
  const theme = req.query.theme || 'dark';

  let query = 'SELECT * FROM stories WHERE approved = 1';
  const params = [];
  if (category) { query += ' AND category = ?'; params.push(category); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(count);

  const stories = db.prepare(query).all(...params);
  stories.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => {
      s.reactions[r.type] = r.count;
    });
  });

  res.render('embed', { stories, theme, count, category, layout: false });
});

app.get('/embed-info', (req, res) => {
  res.render('embed-info', {
    title: 'أداة التضمين - أول مرّة',
    description: 'ضمّن تجارب أول مرّة في موقعك'
  });
});

// ============ FEATURE 20: PUBLIC JSON API ============

// Simple rate limiter
const rateLimits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimits.set(ip, entry);
  if (entry.count > 100) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

app.get('/api/stories', rateLimit, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = Math.min(20, Math.max(1, parseInt(req.query.per_page) || 10));
  const category = req.query.category || '';
  const offset = (page - 1) * perPage;

  let where = 'WHERE approved = 1';
  const params = [];
  if (category) { where += ' AND category = ?'; params.push(category); }

  const stories = db.prepare(`SELECT id, name, hide_name, done_regrets, notdone_regrets, comment, category, views, shares, created_at FROM stories ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM stories ${where}`).get(...params).count;

  stories.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => {
      s.reactions[r.type] = r.count;
    });
    s.total_reactions = Object.values(s.reactions).reduce((a, b) => a + b, 0);
  });

  res.json({ stories, total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) });
});

app.get('/api/stories/:id', rateLimit, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ? AND approved = 1').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found' });

  story.reactions = {};
  db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(story.id).forEach(r => {
    story.reactions[r.type] = r.count;
  });
  story.total_reactions = Object.values(story.reactions).reduce((a, b) => a + b, 0);

  const comments = db.prepare('SELECT id, name, comment, created_at FROM comments WHERE story_id = ? AND approved = 1 ORDER BY created_at DESC').all(story.id);
  res.json({ story, comments });
});

app.get('/api/categories', rateLimit, (req, res) => {
  const cats = CATEGORIES().map(c => ({
    name: c.name, icon: c.icon,
    count: db.prepare('SELECT COUNT(*) as count FROM stories WHERE approved = 1 AND category = ?').get(c.name).count
  }));
  res.json({ categories: cats });
});

app.get('/api/search', rateLimit, (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ stories: [], total: 0 });

  const term = `%${q}%`;
  const stories = db.prepare(`
    SELECT id, name, hide_name, comment, category, views, created_at FROM stories
    WHERE approved = 1 AND (name LIKE ? OR comment LIKE ? OR done_regrets LIKE ? OR notdone_regrets LIKE ?)
    ORDER BY created_at DESC LIMIT 20
  `).all(term, term, term, term);

  res.json({ stories, total: stories.length, query: q });
});

app.get('/api/docs', (req, res) => {
  res.render('api-docs', {
    title: 'توثيق API - أول مرّة',
    description: 'توثيق واجهة برمجة التطبيقات لأول مرّة'
  });
});

// ============ FEATURES 6-10 ============

// 6. Share Card
app.get('/story/:id/share-card', (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ? AND approved = 1').get(req.params.id);
  if (!story) return res.status(404).send('Not found');
  const doneItems = (story.done_regrets || '').split('|||').filter(Boolean);
  const notDoneItems = (story.notdone_regrets || '').split('|||').filter(Boolean);
  res.render('share-card', { story, doneItems, notDoneItems, layout: false });
});

// 7. Random Story
app.get('/random', (req, res) => {
  const row = db.prepare('SELECT id FROM stories WHERE approved = 1 ORDER BY RANDOM() LIMIT 1').get();
  if (row) res.redirect('/story/' + row.id);
  else res.redirect('/');
});

// 8. Weekly Question - already in settings, passed to index
// (handled in home route below)

// 9. Compare
app.get('/compare', (req, res) => {
  const rows = db.prepare('SELECT * FROM stories WHERE approved = 1 ORDER BY RANDOM() LIMIT 2').all();
  rows.forEach(s => {
    s.reactions = {};
    db.prepare('SELECT type, count FROM reactions WHERE story_id = ?').all(s.id).forEach(r => { s.reactions[r.type] = r.count; });
    s.doneItems = (s.done_regrets || '').split('|||').filter(Boolean);
    s.notDoneItems = (s.notdone_regrets || '').split('|||').filter(Boolean);
    s.commentCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE story_id = ? AND approved = 1').get(s.id).c;
  });
  res.render('compare', { stories: rows, title: '🔄 مقارنة التجارب - أول مرّة', description: 'قارن بين تجربتين عشوائيتين على أول مرّة' });
});

// 10. Global Stats
app.get('/stats', (req, res) => {
  const totalStories = db.prepare('SELECT COUNT(*) as c FROM stories WHERE approved = 1').get().c;
  const totalViews = db.prepare('SELECT SUM(views) as c FROM stories WHERE approved = 1').get().c || 0;
  const totalReactions = db.prepare('SELECT SUM(count) as c FROM reactions').get().c || 0;
  const totalComments = db.prepare('SELECT COUNT(*) as c FROM comments WHERE approved = 1').get().c;

  // Parse regrets
  const allDone = db.prepare("SELECT done_regrets FROM stories WHERE approved = 1 AND done_regrets != ''").all();
  const allNotDone = db.prepare("SELECT notdone_regrets FROM stories WHERE approved = 1 AND notdone_regrets != ''").all();
  const doneCounts = {};
  const notDoneCounts = {};
  let totalDoneItems = 0, totalNotDoneItems = 0;
  allDone.forEach(r => { r.done_regrets.split('|||').filter(Boolean).forEach(i => { doneCounts[i] = (doneCounts[i]||0)+1; totalDoneItems++; }); });
  allNotDone.forEach(r => { r.notdone_regrets.split('|||').filter(Boolean).forEach(i => { notDoneCounts[i] = (notDoneCounts[i]||0)+1; totalNotDoneItems++; }); });
  const topDone = Object.entries(doneCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const topNotDone = Object.entries(notDoneCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);

  // Category distribution
  const catDist = CATEGORIES().map(c => ({
    name: c.name, icon: c.icon,
    count: db.prepare('SELECT COUNT(*) as c FROM stories WHERE approved = 1 AND category = ?').get(c.name).c
  })).sort((a,b)=>b.count-a.count);
  const catMax = catDist[0]?.count || 1;

  const avgDone = totalStories > 0 ? (totalDoneItems / totalStories).toFixed(1) : 0;
  const avgNotDone = totalStories > 0 ? (totalNotDoneItems / totalStories).toFixed(1) : 0;

  res.render('stats', {
    totalStories, totalViews, totalReactions, totalComments,
    totalDoneItems, totalNotDoneItems, avgDone, avgNotDone,
    topDone, topNotDone, catDist, catMax,
    title: '📊 إحصائيات عامة - أول مرّة',
    description: 'إحصائيات شاملة لتجارب أول مرّة'
  });
});

// ============ FEATURE 21: WEBHOOKS ============

db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status_code INTEGER,
    success INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
  );
`);

function fireWebhook(event, data) {
  const webhooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all();
  webhooks.forEach(wh => {
    try {
      const events = JSON.parse(wh.events || '[]');
      if (!events.includes(event) && !events.includes('*')) return;

      const crypto = require('crypto');
      const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
      const sig = wh.secret ? crypto.createHmac('sha256', wh.secret).update(payload).digest('hex') : '';

      fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sig ? { 'X-Webhook-Signature': sig } : {})
        },
        body: payload
      }).then(res => {
        db.prepare('INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, success) VALUES (?, ?, ?, ?, ?)')
          .run(wh.id, event, payload, res.status, res.ok ? 1 : 0);
      }).catch(err => {
        db.prepare('INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, success) VALUES (?, ?, ?, ?, ?)')
          .run(wh.id, event, payload, 0, 0);
      });
    } catch {}
  });
}

// Admin webhooks page
app.get('/admin/webhooks', requireAuth, (req, res) => {
  const webhooks = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  const deliveries = db.prepare('SELECT wd.*, w.url as webhook_url FROM webhook_deliveries wd JOIN webhooks w ON wd.webhook_id = w.id ORDER BY wd.created_at DESC LIMIT 50').all();
  res.render('admin/webhooks', {
    layout: 'admin/layout', webhooks, deliveries,
    title: 'الويب هوكس - أول مرّة'
  });
});

app.post('/admin/webhooks/add', requireAuth, (req, res) => {
  const { url, events, secret } = req.body;
  if (!url) return res.redirect('/admin/webhooks');
  const eventList = (events || '').split(',').map(e => e.trim()).filter(Boolean);
  db.prepare('INSERT INTO webhooks (url, events, secret) VALUES (?, ?, ?)').run(url, JSON.stringify(eventList), secret || '');
  logActivity('إضافة ويب هوك', url);
  res.redirect('/admin/webhooks');
});

app.post('/admin/webhooks/:id/toggle', requireAuth, (req, res) => {
  const wh = db.prepare('SELECT active FROM webhooks WHERE id = ?').get(req.params.id);
  if (wh) {
    db.prepare('UPDATE webhooks SET active = ? WHERE id = ?').run(wh.active ? 0 : 1, req.params.id);
    logActivity('تبديل ويب هوك', `رقم: ${req.params.id}`);
  }
  res.redirect('/admin/webhooks');
});

app.post('/admin/webhooks/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  logActivity('حذف ويب هوك', `رقم: ${req.params.id}`);
  res.redirect('/admin/webhooks');
});

app.post('/admin/webhooks/deliveries/clear', requireAuth, (req, res) => {
  db.prepare('DELETE FROM webhook_deliveries').run();
  res.redirect('/admin/webhooks');
});

// Fire webhooks on events
// story.created - in submit route
// story.approved - in approve route  
// ============ FEATURE 16: AUDIT LOG ============

app.get('/admin/audit-log', requireSuper, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 30;
  const offset = (page - 1) * perPage;
  const actionFilter = req.query.action || '';
  const userFilter = req.query.user || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (actionFilter) { where += ' AND action LIKE ?'; params.push(`%${actionFilter}%`); }
  if (userFilter) { where += ' AND user LIKE ?'; params.push(`%${userFilter}%`); }

  const logs = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);
  const totalCount = db.prepare(`SELECT COUNT(*) as c FROM audit_log ${where}`).get(...params).c;
  const totalPages = Math.ceil(totalCount / perPage);

  res.render('admin/audit-log', {
    layout: 'admin/layout', logs, currentPage: page, totalPages,
    actionFilter, userFilter,
    title: 'سجل المراجعة - أول مرّة'
  });
});

// ============ FEATURE 18: ADMIN QUICK REPLY ============

app.post('/admin/comment/:id/reply', requireModerator, (req, res) => {
  const { comment } = req.body;
  if (!comment) return res.redirect('/admin/comments');
  const parentComment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!parentComment) return res.redirect('/admin/comments');
  const username = getAdminUsername(req);
  db.prepare('INSERT INTO comments (story_id, parent_id, name, comment, is_admin, approved) VALUES (?, ?, ?, ?, 1, 1)').run(
    parentComment.story_id, req.params.id, username, comment
  );
  logWithAudit(req, 'رد أدمن على تعليق', `رقم التعليق الأصلي: ${req.params.id}`);
  res.redirect('/admin/comments');
});

// ============ FEATURE 20: PDF EXPORT (printable HTML) ============

app.get('/admin/export/pdf', requireModerator, (req, res) => {
  const stories = db.prepare('SELECT * FROM stories WHERE approved = 1 ORDER BY created_at DESC').all();
  res.render('admin/export-pdf', { layout: false, stories, title: 'أول مرّة - تصدير التجارب' });
});

// comment.added - in comment route
// Admin Themes
app.get('/admin/themes', requireAuth, (req, res) => {
  const activeTheme = getSetting('active_theme') || 'red';
  res.render('admin/themes', {
    layout: 'admin/layout',
    themes: THEMES,
    activeTheme,
    title: '🎨 السمات - أول مرّة'
  });
});

app.post('/admin/themes', requireSuper, (req, res) => {
  const { theme } = req.body;
  if (THEMES[theme]) {
    db.prepare("UPDATE site_settings SET value = ? WHERE key = 'active_theme'").run(theme);
    logWithAudit(req, 'تغيير السمة', `السمة الجديدة: ${THEMES[theme].name}`);
  }
  res.clearCookie('awwal_theme');
  res.json({ success: true, theme });
});

// User theme cookie
app.post('/set-theme', (req, res) => {
  const { theme } = req.body;
  if (THEMES[theme]) {
    res.cookie('awwal_theme', theme, { maxAge: 365 * 86400000, path: '/', sameSite: 'lax' });
    res.json({ ok: true, theme });
  } else {
    res.clearCookie('awwal_theme', { path: '/' });
    res.json({ ok: true, theme: 'auto' });
  }
});

app.use((req, res) => {
  const popular = db.prepare('SELECT * FROM stories WHERE approved = 1 ORDER BY views DESC LIMIT 5').all();
  res.status(404).render('404', { title: 'الصفحة غير موجودة', popular });
});

app.listen(PORT, () => {
  console.log(`🦞 أول مرّة running on http://localhost:${PORT}`);
});
