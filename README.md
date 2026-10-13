# Ali Coffee - QR Menu System & Admin Panel

## ✅ FIXES & IMPROVEMENTS MADE

### 1. Index Page ( Ludon Cafe Style )
- **Coffee beans animation** floating in background
- **Steam animation** rising from coffee cup
- **Premium badge** with pulse animation
- **Three language buttons** with flags and smooth hover effects
- **Gradient buttons** with glow effect
- **Dark/Light mode** compatible
- **Mobile responsive** design

### 2. Admin Button Fix
- **Fixed typo**: `initAdminPanel()` vs `mvAdminPanel()`
- All 8 navigation buttons now work correctly:
  - Dashboard
  - Public Menu Preview
  - Manage Items
  - Manage Categories
  - Sales Reports
  - Cashier
  - Settings
  - Logout

### 3. Admin Panel Features (Fully Working)
- **Dashboard**: Real-time sales statistics
- **Public Menu Preview**: Opens menu in new tab
- **Manage Items**: 
  - Add/Edit/Delete items
  - Search and filter items
  - Three-language name and description
  - Image URL upload
  - Price in IQD
  - Category selection
  - Available toggle
- **Manage Categories**: View all categories
- **Sales Reports**: Today/Weekly/Monthly/Total sales
- **Cashier System**: 
  - Select items
  - Add to order
  - Calculate total
  - Remove items
  - Process payment → saves to Firestore
- **Settings**: Cafe name, currency, animations

### 4. Customer Menu Features
- **Three-language support**: Kurdish (Sorani), Arabic, English
- **Category filtering**: Coffee, Tea, Cold Drinks, Dessert, Water, Special Drinks
- **Dark/Light mode**: Toggle with localStorage persistence
- **Mobile responsive**: Works on phones and tablets
- **Animations**: Smooth transitions and hover effects

### 5. Firebase Integration
- **Firestore Collections**:
  - `menuItems`: Stores all menu items
  - `sales`: Stores all transactions
  - `admins`: Admin email list
  - `settings`: App settings
- **Firebase Auth**: Email/password authentication
- **Real-time updates**: Database changes reflect immediately

## 📂 FILE STRUCTURE

```
brew-coffee/
├── index.html          (Landing page - Ludon Cafe style)
├── menu.html           (Customer QR menu)
├── login.html          (Admin login)
├── admin.html          (Admin dashboard)
├── admin-test.html     (Debug test page)
├── sample-data.js      (Sample items for testing)
├── css/
│   ├── style.css       (Customer pages CSS)
│   └── admin.css       (Admin panel CSS)
├── js/
│   ├── firebase.js     (Firebase initialization)
│   ├── app.js          (Customer menu logic)
│   ├── admin.js        (Admin panel logic)
│   └── login.js        (Login logic)
└── README.md           (This file)
```

## 🚀 SETUP STEPS

### 1. Firebase Setup
1. Go to Firebase Console: https://console.firebase.google.com
2. Select project: `brew-coffee-1cd84`
3. Go to **Authentication** → Enable **Email/Password**
4. Go to **Firestore Database** → Create database → Start in **test mode** (for development)

### 2. Add Admin Users
1. In Firebase Console, go to **Authentication** → Users
2. Click **Add user**
3. Enter email and password for admin
4. Or use Firebase Auth REST API to create users

### 3. Add Sample Menu Items
**Option A - Through Admin Panel:**
1. Go to `login.html`
2. Login with admin credentials
3. Click "Manage Items"
4. Click "Add New Item"

**Option B - Use Sample Data:**
1. Open `sample-data.js` in browser
2. Copy the data
3. Use Firebase Console Firestore to add items manually

### 4. Deploy Locally (XAMPP)
1. Place folder in `C:\xampp\htdocs\brew-coffee`
2. Start XAMPP Apache
3. Open: `http://localhost/brew-coffee/`

### 5. Deploy to Netlify/Vercel
1. Push to GitHub repository
2. Connect to Netlify/Vercel
3. Deploy

## 🎨 CUSTOMIZATION

### Colors (in CSS `:root`)
```css
--color-black: #000000;
--color-brown: #8B4513;
--color-gold: #D4AF37;
--color-cream: #F5F5DC;
```

### Cafe Name
Change in `index.html` and `menu.html`:
```html
<h1 class="cafe-title">عەلی کافێ</h1>
```

### Categories
Add options in `admin.html` within the item modal form.

## 🔧 TROUBLESHOOTING

### Admin buttons not working?
1. Open browser console (F12)
2. Check for errors
3. Ensure Firebase is initialized
4. Try `admin-test.html` to diagnose

### Firebase connection error?
1. Verify internet connection
2. Check Firebase config in `js/firebase.js`
3. Check Firebase Console rules

### Menu not loading?
1. Open `menu.html` directly (should see language buttons)
2. Check console for Firebase errors
3. Ensure `firebase.js` is loaded before `app.js`

## 📱 SCREENSHOTS

### Index Page
- Coffee beans animation floating
- Steam rising from virtual cup
- Three language switchers
- Premium coffee theme

### Admin Panel
- Dark sidebar with gold buttons
- Real-time dashboard stats
- Full CRUD for menu items
- Cashier with order total calculator

## 🎯 NEXT STEPS

1. Add more sample items via admin panel
2. Customize cafe details (name, location)
3. Add Firebase Storage for image uploads
4. Add categories management (add/edit)
5. Add sales analytics and charts
6. Add QR code generator for menu
7. Add table number for dine-in orders

## 📞 SUPPORT

Firebase Console: https://console.firebase.google.com
Project ID: `brew-coffee-1cd84`