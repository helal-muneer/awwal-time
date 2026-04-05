# أول مرّة - awwal-time

موقع تجارب الناس - أشياء ندموا عليها وأشياء تمنوا لو فعلتها.

## التقنية
- Node.js 20 + Express
- EJS (templates)
- Tailwind CSS (CDN)
- SQLite (better-sqlite3)
- عربي RTL

## التثبيت على cPanel

1. أنشئ subdomain `awwal-time` من cPanel
2. ارفع الملفات إلى مجلد الـ subdomain
3. من **Setup Node.js App** في cPanel:
   - اختر Node.js 20.x
   - App root: `awwal-time`
   - App URL: `awwal-time.ksawats.com`
   - Startup file: `server.js`
   - أضف متغيرات البيئة من `.env.example`
4. اضغط Create
5. Run NPM Install
6. Start App

## لوحة التحكم
- URL: `awwal-time.ksawats.com/admin`
- المستخدم الافتراضي: `admin`
- **غيّر كلمة المرور فوراً** من `.env`

## الصفحات
- `/` - الرئيسية (عرض التجارب)
- `/submit` - نموذج الإرسال
- `/story/:id` - صفحة التجربة
- `/admin` - لوحة التحكم
- `/privacy` - سياسة الخصوصية
- `/contact` - تواصل معنا
