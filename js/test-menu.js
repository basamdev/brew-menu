// js/test-menu.js - Safe Local Mock & Test Menu Suite (100% Isolated from Firebase)
// Allows instant generation of realistic test categories and items (Pizza, Burger, Foods, Cold/Hot Drinks, Desserts, Ice Cream)
// and 1-click complete wipe without touching or affecting Firebase Firestore!

(function () {
    'use strict';

    var STORAGE_MODE_KEY = 'brew_test_menu_mode';
    var STORAGE_CATS_KEY = 'brew_test_categories';
    var STORAGE_ITEMS_KEY = 'brew_test_items';

    var TEST_CATEGORIES = [
        {
            id: 'cat_test_pizza',
            name_ku: 'پیتزا',
            name_ar: 'بيتزا',
            name_en: 'Pizza',
            image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=300',
            order: 1,
            isTest: true
        },
        {
            id: 'cat_test_burger',
            name_ku: 'بەرگەر',
            name_ar: 'برجر',
            name_en: 'Burger',
            image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300',
            order: 2,
            isTest: true
        },
        {
            id: 'cat_test_foods',
            name_ku: 'خواردنەکان',
            name_ar: 'المأكولات',
            name_en: 'Foods & Pasta',
            image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=300',
            order: 3,
            isTest: true
        },
        {
            id: 'cat_test_cold',
            name_ku: 'خواردنەوەی سارد',
            name_ar: 'مشروبات باردة',
            name_en: 'Cold Drinks',
            image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=300',
            order: 4,
            isTest: true
        },
        {
            id: 'cat_test_hot',
            name_ku: 'خواردنەوەی گەرم',
            name_ar: 'مشروبات ساخنة',
            name_en: 'Hot Drinks',
            image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=300',
            order: 5,
            isTest: true
        },
        {
            id: 'cat_test_dessert',
            name_ku: 'شیرینی و کێک',
            name_ar: 'حلويات وكيك',
            name_en: 'Desserts',
            image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300',
            order: 6,
            isTest: true
        },
        {
            id: 'cat_test_icecream',
            name_ku: 'ئایسکرێم',
            name_ar: 'آيس كريم',
            name_en: 'Ice Cream',
            image: 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=300',
            order: 7,
            isTest: true
        }
    ];

    var TEST_ITEMS = [
        // --- 1. PIZZA ---
        {
            id: 'test_pizza_1',
            category: 'cat_test_pizza',
            name_ku: 'پیتزای پێپەرۆنی شاهانە',
            name_ar: 'بيتزا بيبيروني فاخرة',
            name_en: 'Royal Pepperoni Pizza',
            description_ku: 'پیتزای تەڕ و کریسپی بە مۆزارێلای تازە، سۆسی تەماتەی ئیتاڵی و پێپەرۆنی نایاب',
            description_ar: 'عجينة مقرمشة مع جبنة موزاريلا طازجة، صلصة طماطم إيطالية وشرائح بيبيروني',
            description_en: 'Crispy stone-baked dough with fresh mozzarella, rich tomato sauce and premium pepperoni',
            price: 9000,
            image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=600',
            available: 1,
            badge: 'Popular',
            isTest: true
        },
        {
            id: 'test_pizza_2',
            category: 'cat_test_pizza',
            name_ku: 'پیتزای مارگەرێتا دیلۆکس',
            name_ar: 'بيتزا مارغريتا كلاسيكية',
            name_en: 'Margherita Deluxe Pizza',
            description_ku: 'پیتزای کلاسیکی ئیتاڵی بە پەنیری مۆزارێلا، بیبەر و گەڵای ڕەیحانی فرێش',
            description_ar: 'بيتزا إيطالية أصلية مع جبن الموزاريلا الفاخر وريحان طازج',
            description_en: 'Classic Italian pizza with premium mozzarella, olive oil and fresh basil',
            price: 7500,
            image: 'https://images.unsplash.com/photo-1604382355076-af4b0eb60143?w=600',
            available: 1,
            badge: 'Classic',
            isTest: true
        },
        {
            id: 'test_pizza_3',
            category: 'cat_test_pizza',
            name_ku: 'پیتزای قارچک و تڕوفل',
            name_ar: 'بيتزا الفطر والكمأة',
            name_en: 'Truffle Mushroom Pizza',
            description_ku: 'تێکەڵەی چەندین جۆری قارچکی تازە لەگەڵ سۆسی سپی کرێمی و زەیتی تڕوفل',
            description_ar: 'مزيج فطر طازج مع صلصة بيضاء كريمية وزيت الكمأة العطري',
            description_en: 'Wild mushrooms blend with creamy white sauce and aromatic truffle oil',
            price: 11000,
            image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600',
            available: 1,
            badge: 'Chef Special',
            isTest: true
        },
        {
            id: 'test_pizza_4',
            category: 'cat_test_pizza',
            name_ku: 'پیتزای مریشکی باربیکیو',
            name_ar: 'بيتزا الدجاج المشوي باربيكيو',
            name_en: 'BBQ Smoked Chicken Pizza',
            description_ku: 'مریشکی برژاوی تەندور بە سۆسی باربیکیوی دووکەڵی، پیازی سوور و گەنمەشامی',
            description_ar: 'قطع دجاج مشوي مع صلصة الباربيكيو المدخنة والبصل الأحمر',
            description_en: 'Tender smoked chicken with tangy BBQ sauce, red onions and mozzarella',
            price: 9500,
            image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600',
            available: 1,
            badge: 'New',
            isTest: true
        },

        // --- 2. BURGER ---
        {
            id: 'test_burger_1',
            category: 'cat_test_burger',
            name_ku: 'بەرگەری ئانگۆسی ئەسڵی',
            name_ar: 'برجر لحم أنجوس فاخر',
            name_en: 'Classic Prime Angus Burger',
            description_ku: 'گۆشتی تەڕی ئانگۆسی سروشتی، پەنیری چێداری زەرد، خەیاری سوورکراوە و سۆسی تایبەت',
            description_ar: 'شريحة لحم أنجوس مشوي مع جبنة شيدر ذائبة وصوص البرجر الخاص',
            description_en: 'Pure Angus beef patty with melted cheddar, crisp lettuce and signature sauce',
            price: 8500,
            image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600',
            available: 1,
            badge: 'Best Seller',
            isTest: true
        },
        {
            id: 'test_burger_2',
            category: 'cat_test_burger',
            name_ku: 'بەرگەری مریشکی زینگەر کریسپی',
            name_ar: 'برجر دجاج مقرمش زينجر',
            name_en: 'Crispy Zinger Chicken Burger',
            description_ku: 'سنگی مریشکی کریسپی تیژ بە سۆسی مایۆنیزی هاوس، کاهوو و خەیاری ترش',
            description_ar: 'صدر دجاج مقرمش متبل مع صوص مايونيز خاص وخس مقرمش',
            description_en: 'Golden crispy chicken breast with spicy house mayo and fresh lettuce',
            price: 7500,
            image: 'https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?w=600',
            available: 1,
            badge: 'Crispy',
            isTest: true
        },
        {
            id: 'test_burger_3',
            category: 'cat_test_burger',
            name_ku: 'دەبڵ سمەش بەرگەر بە تڕوفل',
            name_ar: 'دبل سماش برجر مع صلصة الكمأة',
            name_en: 'Truffle Double Smash Burger',
            description_ku: 'دوو چینی گۆشتی سمەشکراوی بەتام لەگەڵ سۆسی تڕوفلی ڕەش و پەنیری سویسری',
            description_ar: 'طبقتين لحم سماش محمر مع صلصة الكمأة السوداء وجبن سويسري',
            description_en: 'Two crispy smash patties with rich black truffle aioli and swiss cheese',
            price: 10500,
            image: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=600',
            available: 1,
            badge: 'Luxury',
            isTest: true
        },
        {
            id: 'test_burger_4',
            category: 'cat_test_burger',
            name_ku: 'مشروم سویس بەرگەر',
            name_ar: 'برجر الفطر والجبن السويسري',
            name_en: 'Mushroom Swiss Burger',
            description_ku: 'گۆشتی ئانگۆس لەگەڵ قارچکی سوورکراوە بە کەرەی گەرم و پەنیری سویسری تواوە',
            description_ar: 'لحم بقري مع فطر سوتيه بالزبدة وجبن سويسري ذائب',
            description_en: 'Juicy beef patty topped with sautéed butter mushrooms and melted swiss',
            price: 8500,
            image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=600',
            available: 1,
            badge: 'Special',
            isTest: true
        },

        // --- 3. FOODS & PASTA ---
        {
            id: 'test_food_1',
            category: 'cat_test_foods',
            name_ku: 'پاستای فیتۆچینی ئەلفرێدۆ بە مریشک',
            name_ar: 'فيتوتشيني ألفريدو بالدجاج',
            name_en: 'Chicken Fettuccine Alfredo',
            description_ku: 'پاستای فیتۆچینی ئیتاڵی بە سۆسی کرێمی دەوڵەمەند، قارچک و مریشکی برژاو',
            description_ar: 'مكرونة فيتوتشيني مع صلصة ألفريدو كريمية غنية وقطع دجاج مشوي',
            description_en: 'Classic fettuccine pasta in rich parmesan cream sauce with grilled chicken',
            price: 9500,
            image: 'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?w=600',
            available: 1,
            badge: 'Popular',
            isTest: true
        },
        {
            id: 'test_food_2',
            category: 'cat_test_foods',
            name_ku: 'چیکن تێندەرز بە هەنگوین و خەردەل',
            name_ar: 'تندر دجاج مقرمش مع صوص الماسترد',
            name_en: 'Crispy Chicken Tenders',
            description_ku: 'پەنجە مریشکی کریسپی زێڕین لەگەڵ پەتاتەی فینلاندی و سۆسی هەنگوین و خەردەل',
            description_ar: 'أصابع دجاج مقرمشة ذهبية تقدم مع بطاطا مقلية وصوص الخردل والعسل',
            description_en: 'Golden hand-breaded tenders served with crispy fries and honey mustard dip',
            price: 7000,
            image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600',
            available: 1,
            badge: 'Crispy',
            isTest: true
        },
        {
            id: 'test_food_3',
            category: 'cat_test_foods',
            name_ku: 'زەڵاتەی سیزەر بە مریشک',
            name_ar: 'سلطة سيزر مع دجاج مشوي',
            name_en: 'Grilled Chicken Caesar Salad',
            description_ku: 'کاهووی ڕۆمانی فرێش بە مریشکی برژاو، کرۆتۆنی برژاو، پەنیری پەرمێزان و سۆسی سیزەر',
            description_ar: 'خس روماني طازج مع قطع دجاج مشوي وجبن بارميزان وصوص السيزر الأصلي',
            description_en: 'Crisp romaine lettuce with grilled chicken, parmesan flakes and caesar dressing',
            price: 6500,
            image: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=600',
            available: 1,
            badge: 'Fresh',
            isTest: true
        },
        {
            id: 'test_food_4',
            category: 'cat_test_foods',
            name_ku: 'پەتاتەی تڕوفل بە پەرمێزان',
            name_ar: 'بطاطا مقلية بالكمأة والبارميزان',
            name_en: 'Truffle Parmesan Golden Fries',
            description_ku: 'پەتاتەی کریسپی بە زەیتی تڕوفلی ئیتاڵی، پەنیری پەرمێزان و مەعدەنووسی فرێش',
            description_ar: 'بطاطس مقرمشة متبلة بزيت الكمأة الفاخر وجبن البارميزان المبشور',
            description_en: 'Golden crispy skin-on fries tossed with aromatic truffle oil and shaved parmesan',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600',
            available: 1,
            badge: 'Hot',
            isTest: true
        },

        // --- 4. COLD DRINKS & MOJITOS ---
        {
            id: 'test_cold_1',
            category: 'cat_test_cold',
            name_ku: 'سپانیش لاتەی سارد',
            name_ar: 'سبانش لاتيه بارد',
            name_en: 'Iced Spanish Latte',
            description_ku: 'ئێسپرێسۆی تایبەت بە شیری تەڕ و شیرینکراوی مکثف لەگەڵ بەفری وردکراو',
            description_ar: 'إسبريسو غني مع حليب مكثف محلى ومثلج',
            description_en: 'Rich espresso poured over sweet condensed milk and chilled whole milk',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=600',
            available: 1,
            badge: 'Best Seller',
            isTest: true
        },
        {
            id: 'test_cold_2',
            category: 'cat_test_cold',
            name_ku: 'مۆهیتۆی پاشن فروت و نەعنا',
            name_ar: 'موهيتو باشن فروت المنعش',
            name_en: 'Passion Fruit Mint Mojito',
            description_ku: 'خواردنەوەی گازی ئارامبەخش بە میوەی پاشن فروت، لیمۆی تازە و نەعنای باخچە',
            description_ar: 'مشروب غازي منعش مع لب الباشن فروت والليمون وأوراق النعناع الطازج',
            description_en: 'Refreshing sparkling cooler with tropical passion fruit pulp, lime and mint',
            price: 4000,
            image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600',
            available: 1,
            badge: 'Fresh',
            isTest: true
        },
        {
            id: 'test_cold_3',
            category: 'cat_test_cold',
            name_ku: 'بلو ئۆشن برێز',
            name_ar: 'مشروب المحيط الأزرق الفوار',
            name_en: 'Blue Ocean Citrus Cooler',
            description_ku: 'تێکەڵەی شینی گازی بە تەعمی بلوبێری و لیمۆی سیسیلی بەفراوی',
            description_ar: 'مشروب أزرق فوار بنكهة التوت الأزرق والحمضيات المثلجة',
            description_en: 'Vibrant sparkling blue curaçao flavor layered with citrus lemonade over crushed ice',
            price: 4000,
            image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600',
            available: 1,
            badge: 'Cool',
            isTest: true
        },
        {
            id: 'test_cold_4',
            category: 'cat_test_cold',
            name_ku: 'سموزی مانگۆی فرێش',
            name_ar: 'سموذي المانجو الاستوائي الطازج',
            name_en: 'Tropical Mango Smoothie',
            description_ku: 'شەربەتی خەستی مانگۆی سروشتی سەدا سەد فرێش بە کەمێک هەنگوین و شیر',
            description_ar: 'عصير مانجو استوائي كثيف ومثلج طبيعي 100%',
            description_en: 'Thick and creamy blend of fresh ripe tropical mangoes with a touch of honey',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=600',
            available: 1,
            badge: 'Natural',
            isTest: true
        },

        // --- 5. HOT DRINKS & COFFEE ---
        {
            id: 'test_hot_1',
            category: 'cat_test_hot',
            name_ku: 'قاوەی تایبەتی موکای بروو',
            name_ar: 'بريو موكا الخاصة بالشوكولاتة',
            name_en: 'Signature Brew Mocha',
            description_ku: 'قاوەی ئێسپرێسۆی تایبەتی بروو بە چۆکۆلێتی بەلجیکی تواوە و شیری گەرمی فۆمدار',
            description_ar: 'مشروب موكا فاخر ممزوج بالشوكولاتة البلجيكية الذائبة وحليب مبخر',
            description_en: 'Double espresso blended with premium Belgian dark chocolate and microfoam milk',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=600',
            available: 1,
            badge: 'Signature',
            isTest: true
        },
        {
            id: 'test_hot_2',
            category: 'cat_test_hot',
            name_ku: 'فلات وایتی ئوسترالی',
            name_ar: 'فلات وايت أسترالي بحليب مخملي',
            name_en: 'Velvet Australian Flat White',
            description_ku: 'دوو شۆتی ئێسپرێسۆی ریستریتۆ لەگەڵ شیری ناسک و ڤێلڤێتی بە هونەری لاتی ئارت',
            description_ar: 'إسبريسو مزدوج ريستريتو مع طبقة رقيقة من الحليب المخملي المبخر',
            description_en: 'Double ristretto shot finished with velvety, micro-textured steamed milk',
            price: 4000,
            image: 'https://images.unsplash.com/photo-1534778101976-62847782c213?w=600',
            available: 1,
            badge: 'Barista Pick',
            isTest: true
        },
        {
            id: 'test_hot_3',
            category: 'cat_test_hot',
            name_ku: 'کارامێل ماکیاتۆ',
            name_ar: 'كراميل ماكياتو ساخن',
            name_en: 'Caramel Macchiato Latte',
            description_ku: 'شیری فۆمداری فانیلا بە شۆتی ئێسپرێسۆ لە سەرەوە و سۆسی کارامێلی تەڕ',
            description_ar: 'حليب مبخر مع فانيلا وإسبريسو مغطى بخيوط الكراميل الذهبي',
            description_en: 'Freshly steamed milk with vanilla, marked with espresso and drizzled with caramel',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?w=600',
            available: 1,
            badge: 'Popular',
            isTest: true
        },
        {
            id: 'test_hot_4',
            category: 'cat_test_hot',
            name_ku: 'قاوەی کوردی و تورکی بە هێڵ',
            name_ar: 'قهوة تركية وكردية بالهيل الطازج',
            name_en: 'Traditional Cardamom Coffee',
            description_ku: 'قاوەی کەلەپووری هاڕڕاوی کوالێتی باڵا بە هێڵی فرێش و کەفی ئەستوور',
            description_ar: 'قهوة مطحونة طازجة ممزوجة بالهيل الأخضر ورغوة غنية تقليدية',
            description_en: 'Freshly ground premium coffee brewed slowly with fragrant green cardamom pods',
            price: 3000,
            image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600',
            available: 1,
            badge: 'Traditional',
            isTest: true
        },

        // --- 6. DESSERTS ---
        {
            id: 'test_dessert_1',
            category: 'cat_test_dessert',
            name_ku: 'سان سیباستیان بە چۆکۆلێت',
            name_ar: 'تشيز كيك سان سيباستيان بالشوكولاتة',
            name_en: 'San Sebastian Burnt Cheesecake',
            description_ku: 'چیزکێکی بەناوبانگی برژاوی ئیسپانی بە دڵی کرێمی و تواوە، لەگەڵ سۆسی چۆکۆلێت',
            description_ar: 'تشيز كيك إسباني محروق وقوام كريمي ناعم مغطى بشوكولاتة بلجيكية ذائبة',
            description_en: 'Basque burnt cheesecake with a luscious molten center, served with warm Belgian chocolate',
            price: 6000,
            image: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600',
            available: 1,
            badge: 'Top Rated',
            isTest: true
        },
        {
            id: 'test_dessert_2',
            category: 'cat_test_dessert',
            name_ku: 'کێکی مۆڵتنی چۆکۆلێت بە دۆندرمە',
            name_ar: 'كيك اللافا الساخن بالشوكولاتة الذائبة',
            name_en: 'Molten Chocolate Lava Cake',
            description_ku: 'کێکی گەرمی چۆکۆلێت بە دڵی شلی فوار، پێشکەش دەکرێت لەگەڵ سکۆپی دۆندرمەی فانیلا',
            description_ar: 'كيك شوكولاتة دافئ يتدفق منه صوص الشوكولاتة، يقدم مع آيس كريم فانيلا',
            description_en: 'Warm chocolate cake with an erupting molten core, served with vanilla bean ice cream',
            price: 5500,
            image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600',
            available: 1,
            badge: 'Warm',
            isTest: true
        },
        {
            id: 'test_dessert_3',
            category: 'cat_test_dessert',
            name_ku: 'تیرامیسۆی ڕەسەنی ئیتاڵی',
            name_ar: 'تيراميسو إيطالي أصلي بقهوة بريو',
            name_en: 'Authentic Italian Tiramisu',
            description_ku: 'بیسکوویتی لیدی فینگەر نقومکراو لە قاوەی ئێسپرێسۆی بروو لەگەڵ پەنیری ماسکارپۆنێی کرێمی',
            description_ar: 'طبقات بسكويت مبللة بالإسبريسو الطازج مع كريمة ماسكاربوني وبودرة كاكاو',
            description_en: 'Espresso-soaked savoiardi layered with whipped mascarpone cream and cocoa dust',
            price: 5000,
            image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600',
            available: 1,
            badge: 'Classic',
            isTest: true
        },
        {
            id: 'test_dessert_4',
            category: 'cat_test_dessert',
            name_ku: 'بەقڵاوەی فستقی عنتاب',
            name_ar: 'بقلاوة بالفستق الحلبي الفاخر',
            name_en: 'Pistachio Baklava Supreme',
            description_ku: 'چەندین چینی ناسک و کریسپی بەقڵاوە بە کەرەی سروشتی و پڕ لە فستقی عنتابی تازە',
            description_ar: 'طبقات رقائق هشة ومقرمشة بالسمن البلدي ومحشوة بأجود أنواع الفستق',
            description_en: 'Flaky phyllo pastry layers bathed in honey syrup and packed with roasted Antep pistachios',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1519869325930-281384150729?w=600',
            available: 1,
            badge: 'Special',
            isTest: true
        },

        // --- 7. ICE CREAM & GELATO ---
        {
            id: 'test_icecream_1',
            category: 'cat_test_icecream',
            name_ku: 'جێلاتۆی فستقی ئیتاڵی',
            name_ar: 'جيلاتو الفستق الإيطالي الحرفي',
            name_en: 'Artisan Pistachio Gelato',
            description_ku: 'ئایسکرێمی کرێمی بە فستقی ١٠٠٪ سروشتی سیسیلی بە شیری فرێشی گوند',
            description_ar: 'آيس كريم جيلاتو إيطالي أصلي بالفستق الطبيعي وقوام حريري ناعم',
            description_en: 'Authentic slow-churned Italian gelato crafted with 100% pure roasted Sicilian pistachios',
            price: 4500,
            image: 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=600',
            available: 1,
            badge: 'Italian',
            isTest: true
        },
        {
            id: 'test_icecream_2',
            category: 'cat_test_icecream',
            name_ku: 'سکۆپی چۆکۆلێتی ڕەشی بەلجیکی',
            name_ar: 'آيس كريم الشوكولاتة البلجيكية الداكنة',
            name_en: 'Belgian Dark Chocolate Scoop',
            description_ku: 'چۆکۆلێتی قووڵی ٧٠٪ بەلجیکی بە کرێمێکی ناسک و پارچەی چۆکۆلێتی کریسپی',
            description_ar: 'سكوب شوكولاتة داكنة 70% بنكهة غنية ومكثفة مع قطع كاكاو',
            description_en: 'Decadent 70% dark Belgian cocoa gelato with crunchy chocolate flakes',
            price: 4000,
            image: 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?w=600',
            available: 1,
            badge: 'Rich',
            isTest: true
        },
        {
            id: 'test_icecream_3',
            category: 'cat_test_icecream',
            name_ku: 'سۆربێتی تووت و شلکی فرێش',
            name_ar: 'سوربيه التوت البري والفراولة المنعشة',
            name_en: 'Wild Berry & Strawberry Sorbet',
            description_ku: 'سۆربێتی بەستووی میوەیی بێ شیر بە تەعمی شلک و تووتی کێوی فرێش',
            description_ar: 'سوربيه مثلج نباتي منعش من التوت والفراولة الطازجة بدون ألبان',
            description_en: 'Dairy-free refreshing frozen sorbet bursting with real wild berries and ripe strawberries',
            price: 4000,
            image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=600',
            available: 1,
            badge: 'Fruity',
            isTest: true
        }
    ];

    function isTestModeActive() {
        return localStorage.getItem(STORAGE_MODE_KEY) === 'true';
    }

    function getTestCategories() {
        if (!isTestModeActive()) return [];
        try {
            var raw = localStorage.getItem(STORAGE_CATS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return TEST_CATEGORIES.slice();
    }

    function getTestItems() {
        if (!isTestModeActive()) return [];
        try {
            var raw = localStorage.getItem(STORAGE_ITEMS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return TEST_ITEMS.slice();
    }

    function injectTestMenu(options) {
        options = options || {};
        try {
            localStorage.setItem(STORAGE_MODE_KEY, 'true');
            localStorage.setItem(STORAGE_CATS_KEY, JSON.stringify(TEST_CATEGORIES));
            localStorage.setItem(STORAGE_ITEMS_KEY, JSON.stringify(TEST_ITEMS));

            // Invalidate cache signatures so menu.html immediately forces repaint
            localStorage.removeItem('cachedMenuItems');
            localStorage.removeItem('cachedMenuItemsSig');
            localStorage.removeItem('cachedCategories');
            localStorage.removeItem('cachedCategoriesSig');

            // If MenuData is loaded, notify it immediately
            if (window.MenuData && typeof window.MenuData.syncTestMode === 'function') {
                window.MenuData.syncTestMode();
            }

            // Broadcast event across tabs/windows
            dispatchTestChangeEvent('injected');
            return {
                success: true,
                categoriesCount: TEST_CATEGORIES.length,
                itemsCount: TEST_ITEMS.length
            };
        } catch (err) {
            console.error('[TestMenu] inject error:', err);
            return { success: false, error: err.message };
        }
    }

    function clearTestMenu() {
        try {
            localStorage.removeItem(STORAGE_MODE_KEY);
            localStorage.removeItem(STORAGE_CATS_KEY);
            localStorage.removeItem(STORAGE_ITEMS_KEY);

            // Invalidate cache signatures so menu.html immediately reverts to real DB data
            localStorage.removeItem('cachedMenuItems');
            localStorage.removeItem('cachedMenuItemsSig');
            localStorage.removeItem('cachedCategories');
            localStorage.removeItem('cachedCategoriesSig');

            // If MenuData is loaded, notify it immediately
            if (window.MenuData && typeof window.MenuData.syncTestMode === 'function') {
                window.MenuData.syncTestMode();
            }

            // Broadcast event across tabs/windows
            dispatchTestChangeEvent('cleared');
            return { success: true };
        } catch (err) {
            console.error('[TestMenu] clear error:', err);
            return { success: false, error: err.message };
        }
    }

    function dispatchTestChangeEvent(action) {
        try {
            var evt = new CustomEvent('brew_test_menu_changed', {
                detail: { action: action, active: isTestModeActive() }
            });
            window.dispatchEvent(evt);
        } catch (e) {}
    }

    // Listen for storage events from other tabs
    window.addEventListener('storage', function (e) {
        if (e.key === STORAGE_MODE_KEY || e.key === STORAGE_ITEMS_KEY || e.key === STORAGE_CATS_KEY) {
            if (window.MenuData && typeof window.MenuData.syncTestMode === 'function') {
                window.MenuData.syncTestMode();
            }
            dispatchTestChangeEvent('storage_sync');
        }
    });

    function updateMenuIndicatorUI() {
        var bar = document.getElementById('testMenuIndicatorBar');
        if (!bar) return;
        var active = isTestModeActive();
        bar.style.display = active ? 'block' : 'none';

        if (active) {
            var lang = localStorage.getItem('selectedLang') || 'ku';
            var titleEl = document.getElementById('testIndicatorTitle');
            var subEl = document.getElementById('testIndicatorSubtitle');
            if (titleEl) {
                titleEl.textContent = lang === 'ku' ? 'دۆخی تاقیکاری ناوخۆیی (Safe Demo)' : (lang === 'ar' ? 'وضع التجربة المحلي (Safe Demo)' : 'Safe Local Mock Mode');
            }
            if (subEl) {
                subEl.textContent = lang === 'ku' ? '• بەبێ دەستکاری Firebase (سڕینەوە بە ١ کلیک)' : (lang === 'ar' ? '• بدون لمس فايربيس (حذف بنقرة واحدة)' : '• Zero Firebase Impact (1-Click Wipe)');
            }
        }
    }

    function initMenuIndicator() {
        updateMenuIndicatorUI();

        var clearBtn = document.getElementById('btnTestIndicatorClear');
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', function () {
                clearTestMenu();
                updateMenuIndicatorUI();
                if (typeof showToast === 'function') {
                    showToast('🗑️ هەموو ئایتم و بەشە تاقیکارییەکان بە سەرکەوتوویی سڕانەوە');
                }
            });
        }
    }

    // Auto-init on page load and events
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMenuIndicator);
    } else {
        initMenuIndicator();
    }

    window.addEventListener('brew_test_menu_changed', function () {
        updateMenuIndicatorUI();
    });

    window.TestMenu = {
        isTestModeActive: isTestModeActive,
        getTestCategories: getTestCategories,
        getTestItems: getTestItems,
        injectTestMenu: injectTestMenu,
        clearTestMenu: clearTestMenu,
        initMenuIndicator: initMenuIndicator,
        sampleCategories: TEST_CATEGORIES,
        sampleItems: TEST_ITEMS
    };
})();
