/* =====================================================
   الواحة فود — JavaScript النهائي (النسخة الذهبية V3)
   مع نظام تحكم كامل من الإعدادات + العمل بدون إنترنت
   ===================================================== */

(() => {
  'use strict';

  /* -------------------------
     Helpers & LocalStorage
     ------------------------- */
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const qa = sel => Array.from(document.querySelectorAll(sel));

  const LS_KEYS = {
    sections: 'waha_v3_sections',
    products: 'waha_v3_products',
    cart: 'waha_v3_cart',
    theme: 'waha_v3_theme',
    dark: 'waha_v3_dark',
    logo: 'waha_v3_logo',
    customIcons: 'waha_v3_custom_icons',
    firebaseConfig: 'waha_v3_firebase_config',
    orders: 'waha_v3_orders',
    lastSync: 'waha_v3_last_sync',
    reviews: 'waha_v3_reviews',
    discounts: 'waha_v3_discounts'
  };

  // مفاتيح إعدادات المتجر
  const STORE_SETTINGS_KEYS = {
    storeName: 'waha_v3_store_name',
    whatsappNumber: 'waha_v3_whatsapp_number',
    storeDescription: 'waha_v3_store_description',
    storeAddress: 'waha_v3_store_address',
    productsPerRow: 'waha_v3_products_per_row',
    fontSize: 'waha_v3_font_size',
    fontFamily: 'waha_v3_font_family',
    showAnimations: 'waha_v3_show_animations',
    showTopSellers: 'waha_v3_show_top_sellers',
    autoOpenCart: 'waha_v3_auto_open_cart',
    requireLogin: 'waha_v3_require_login',
    autoLogout: 'waha_v3_auto_logout',
    backupToCloud: 'waha_v3_backup_to_cloud',
    safeDeleteLimit: 'waha_v3_safe_delete_limit'
  };

  /* -------------------------
     نظام العمل بدون إنترنت مع مزامنة تلقائية
     ------------------------- */
  const OFFLINE_QUEUE_KEY = 'waha_v3_offline_queue';
  const SYNC_DEBOUNCE_DELAY = 5000; // 5 ثواني قبل المزامنة

  let isOnline = navigator.onLine;
  let syncTimeout = null;
  let pendingSync = false;

  // تحميل قائمة الانتظار للمهام المؤجلة
  function loadOfflineQueue() {
    return load(OFFLINE_QUEUE_KEY, []);
  }

  // حفظ مهمة في قائمة الانتظار
  function addToOfflineQueue(action, data) {
    const queue = loadOfflineQueue();
    queue.push({
      id: uid('offline'),
      action,
      data,
      timestamp: new Date().toISOString(),
      attempts: 0
    });
    save(OFFLINE_QUEUE_KEY, queue);
    console.log(`📝 تم إضافة مهمة إلى قائمة الانتظار: ${action}`);
  }

  // معالجة قائمة الانتظار عند عودة الإنترنت
  async function processOfflineQueue() {
    if (!isOnline || !firebaseInitialized) return;
    
    const queue = loadOfflineQueue();
    if (queue.length === 0) return;
    
    showToast('🔄 جاري مزامنة التغييرات...', 3000);
    
    const successfulActions = [];
    const failedActions = [];
    
    for (const item of queue) {
      try {
        let success = false;
        
        switch (item.action) {
          case 'ADD_PRODUCT':
            const addResult = await saveProduct(item.data, true);
            success = addResult.success;
            break;
            
          case 'UPDATE_PRODUCT':
            const updateResult = await saveProduct(item.data, false);
            success = updateResult.success;
            break;
            
          case 'DELETE_PRODUCT':
            if (firebaseInitialized && db) {
              await db.collection('products').doc(item.data.id).delete();
              success = true;
            }
            break;
            
          case 'ADD_SECTION':
            await saveSection(item.data, true);
            success = true;
            break;
            
          case 'UPDATE_SECTION':
            await saveSection(item.data, false);
            success = true;
            break;
            
          case 'DELETE_SECTION':
            await deleteSection(item.data.id);
            success = true;
            break;
            
          case 'ADD_ORDER':
            await saveOrderToFirebase(item.data);
            success = true;
            break;
        }
        
        if (success) {
          successfulActions.push(item.id);
        } else {
          failedActions.push(item.id);
        }
        
        // تأخير بسيط بين كل عملية لتجنب الضغط على السيرفر
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`فشل في معالجة المهمة ${item.action}:`, error);
        failedActions.push(item.id);
      }
    }
    
    // إزالة المهام الناجحة من قائمة الانتظار
    const updatedQueue = queue.filter(item => !successfulActions.includes(item.id));
    
    // زيادة عدد المحاولات للمهام الفاشلة
    updatedQueue.forEach(item => {
      if (failedActions.includes(item.id)) {
        item.attempts = (item.attempts || 0) + 1;
      }
    });
    
    // إزالة المهام التي فشلت أكثر من 3 مرات
    const finalQueue = updatedQueue.filter(item => item.attempts < 3);
    
    save(OFFLINE_QUEUE_KEY, finalQueue);
    
    if (successfulActions.length > 0) {
      showToast(`✅ تم مزامنة ${successfulActions.length} مهمة`, 3000);
    }
    
    if (failedActions.length > 0) {
      console.warn(`❌ فشل في مزامنة ${failedActions.length} مهمة`);
    }
    
    // إعادة تحميل البيانات من السحابة للتأكد من المزامنة الكاملة
    if (successfulActions.length > 0) {
      setTimeout(() => {
        syncAllFromFirebase().catch(console.error);
      }, 2000);
    }
  }

  // دالة محسنة لحفظ المنتج مع دعم العمل بدون إنترنت
  async function saveProductWithOfflineSupport(product, isNew = false) {
    if (isOnline && firebaseInitialized) {
      // إذا كان هناك اتصال، حاول الحفظ مباشرة في Firebase
      try {
        const result = await saveProduct(product, isNew);
        return result;
      } catch (error) {
        console.error('فشل الحفظ في السحابة، الانتقال للوضع غير المتصل:', error);
        // إذا فشل الحفظ في السحابة، انتقل للوضع غير المتصل
        isOnline = false;
      }
    }
    
    // الحفظ المحلي وإضافة المهمة لقائمة الانتظار
    let productToSave = { ...product };
    
    if (isNew) {
      productToSave.id = uid('p');
      state.products.unshift(productToSave);
    } else {
      state.products = state.products.map(p => p.id === productToSave.id ? productToSave : p);
    }
    
    save(LS_KEYS.products, state.products);
    
    // إضافة المهمة لقائمة الانتظار
    addToOfflineQueue(isNew ? 'ADD_PRODUCT' : 'UPDATE_PRODUCT', productToSave);
    
    return { 
      success: true, 
      id: productToSave.id, 
      fromCloud: false, 
      localOnly: true,
      queued: true
    };
  }

  // دالة محسنة لحذف المنتج مع دعم العمل بدون إنترنت
  async function deleteProductWithOfflineSupport(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    // حذف محلي أولاً
    state.products = state.products.filter(p => p.id !== productId);
    save(LS_KEYS.products, state.products);
    
    if (isOnline && firebaseInitialized) {
      try {
        await db.collection('products').doc(productId).delete();
        showToast('🗑️ تم حذف المنتج من السحابة');
      } catch (error) {
        console.error('فشل حذف المنتج من السحابة:', error);
        // إضافة مهمة حذف لقائمة الانتظار
        addToOfflineQueue('DELETE_PRODUCT', { id: productId });
        showToast('🗑️ تم حذف المنتج محلياً وسيتم المزامنة لاحقاً');
      }
    } else {
      // إضافة مهمة حذف لقائمة الانتظار
      addToOfflineQueue('DELETE_PRODUCT', { id: productId });
      showToast('🗑️ تم حذف المنتج محلياً وسيتم المزامنة لاحقاً');
    }
    
    renderProducts();
    renderAdminProducts();
    playSound('delete');
  }

  // تحديث حالة الاتصال
  function updateOnlineStatus() {
    const wasOnline = isOnline;
    isOnline = navigator.onLine;
    
    if (!wasOnline && isOnline) {
      // انتقل من غير متصل إلى متصل
      showToast('🌐 تم استعادة الاتصال بالإنترنت - جاري المزامنة...', 3000);
      
      // محاولة إعادة الاتصال بـ Firebase
      if (state.firebaseConfig.apiKey && !firebaseInitialized) {
        initializeFirebase(state.firebaseConfig);
      }
      
      // معالجة قائمة الانتظار بعد تأخير قصير
      setTimeout(() => {
        processOfflineQueue();
      }, 2000);
      
    } else if (wasOnline && !isOnline) {
      // انتقل من متصل إلى غير متصل
      showToast('⚠️ فقدان الاتصال بالإنترنت - العمل في الوضع المحلي', 5000);
    }
    
    // تحديث واجهة حالة الاتصال
    updateConnectionStatusUI();
    updateOfflineQueueUI();
  }

  // تحديث واجهة حالة الاتصال
  function updateConnectionStatusUI() {
    const statusIndicator = document.getElementById('connectionStatus') || createConnectionStatusIndicator();
    
    if (isOnline) {
      statusIndicator.innerHTML = '🌐 متصل';
      statusIndicator.style.background = '#4caf50';
    } else {
      statusIndicator.innerHTML = '⚠️ غير متصل';
      statusIndicator.style.background = '#ff9800';
    }
  }

  // إنشاء مؤشر حالة الاتصال في الواجهة
  function createConnectionStatusIndicator() {
    const statusIndicator = document.createElement('div');
    statusIndicator.id = 'connectionStatus';
    statusIndicator.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: #4caf50;
      color: white;
      padding: 5px 10px;
      border-radius: 15px;
      font-size: 12px;
      font-weight: bold;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    
    document.body.appendChild(statusIndicator);
    return statusIndicator;
  }

  // نظام المزامنة التلقائية
  function setupAutoSync() {
    // المزامنة عند تغيير البيانات المحلية
    const originalSave = save;
    window.save = function(key, val) {
      const result = originalSave(key, val);
      
      if (isOnline && firebaseInitialized && !pendingSync) {
        pendingSync = true;
        
        clearTimeout(syncTimeout);
        syncTimeout = setTimeout(async () => {
          try {
            await syncAllToFirebase();
            pendingSync = false;
          } catch (error) {
            console.error('فشل المزامنة التلقائية:', error);
            pendingSync = false;
          }
        }, SYNC_DEBOUNCE_DELAY);
      }
      
      return result;
    };
  }

  function save(key, val) { 
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.error('فشل في حفظ البيانات:', e);
      return false;
    }
  }

  function load(key, fallback) { 
    try { 
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch(e) { 
      console.warn('خطأ في تحميل البيانات، استخدام القيم الافتراضية:', e);
      return fallback; 
    } 
  }

  function uid(prefix = 'id') { 
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9000)}`; 
  }

  const toastEl = $('toast');
  let toastTimer = null;
  
  function showToast(msg, ms = 3000, type = 'info') {
    if (!toastEl) { 
      console.log(msg); 
      return; 
    }
    
    toastEl.textContent = msg;
    toastEl.className = 'toast'; // إعادة تعيين الفئات
    
    // تخصيص مظهر الإشعار حسب النوع
    switch(type) {
      case 'success':
        toastEl.style.background = 'linear-gradient(135deg, #4caf50, #45a049)';
        break;
      case 'warning':
        toastEl.style.background = 'linear-gradient(135deg, #ff9800, #f57c00)';
        break;
      case 'error':
        toastEl.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
        break;
      default:
        toastEl.style.background = 'linear-gradient(135deg, var(--main-color), #ffa000)';
    }
    
    toastEl.classList.add('show');
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, ms);
  }

  function playSound(soundType) {
    try {
      const soundEl = soundType === 'add' ? $('soundAdd') : $('soundDelete');
      if (soundEl && soundEl.play) {
        soundEl.currentTime = 0;
        soundEl.play().catch(e => console.log('لا يمكن تشغيل الصوت:', e));
      }
    } catch (e) {
      console.log('خطأ في تشغيل الصوت:', e);
    }
  }

  /* -------------------------
     إعدادات المتجر الشاملة
     ------------------------- */
  function loadStoreSettings() {
    return {
      storeName: localStorage.getItem(STORE_SETTINGS_KEYS.storeName) || 'الواحة فود',
      whatsappNumber: localStorage.getItem(STORE_SETTINGS_KEYS.whatsappNumber) || '201095985529',
      storeDescription: localStorage.getItem(STORE_SETTINGS_KEYS.storeDescription) || 'متجر الواحة فود - أفضل المنتجات الغذائية',
      storeAddress: localStorage.getItem(STORE_SETTINGS_KEYS.storeAddress) || '',
      productsPerRow: localStorage.getItem(STORE_SETTINGS_KEYS.productsPerRow) || '4',
      fontSize: localStorage.getItem(STORE_SETTINGS_KEYS.fontSize) || 'medium',
      fontFamily: localStorage.getItem(STORE_SETTINGS_KEYS.fontFamily) || 'Cairo, sans-serif',
      showAnimations: localStorage.getItem(STORE_SETTINGS_KEYS.showAnimations) !== 'false',
      showTopSellers: localStorage.getItem(STORE_SETTINGS_KEYS.showTopSellers) !== 'false',
      autoOpenCart: localStorage.getItem(STORE_SETTINGS_KEYS.autoOpenCart) !== 'false',
      requireLogin: localStorage.getItem(STORE_SETTINGS_KEYS.requireLogin) === 'true',
      autoLogout: localStorage.getItem(STORE_SETTINGS_KEYS.autoLogout) !== 'false',
      backupToCloud: localStorage.getItem(STORE_SETTINGS_KEYS.backupToCloud) !== 'false',
      safeDeleteLimit: localStorage.getItem(STORE_SETTINGS_KEYS.safeDeleteLimit) || '2'
    };
  }

  function saveStoreSettings(settings) {
    Object.keys(settings).forEach(key => {
      if (STORE_SETTINGS_KEYS[key]) {
        localStorage.setItem(STORE_SETTINGS_KEYS[key], settings[key]);
      }
    });
    return true;
  }

  function applyStoreSettings(settings) {
    // تطبيق اسم المتجر
    const brandName = document.querySelector('.brand-name');
    if (brandName && settings.storeName) {
      brandName.textContent = settings.storeName;
    }

    // تطبيق إعدادات الشبكة
    if (settings.productsPerRow) {
      const productGrid = document.getElementById('productGrid');
      if (productGrid) {
        const minWidth = 170 / (settings.productsPerRow / 4);
        productGrid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minWidth}px, 1fr))`;
      }
    }

    // تطبيق إعدادات الخط
    document.body.style.fontFamily = settings.fontFamily;
    document.body.style.fontSize = settings.fontSize === 'small' ? '14px' : 
                                   settings.fontSize === 'large' ? '18px' : '16px';

    // تطبيق إعدادات العرض
    const topSellers = document.querySelector('.top-sellers');
    if (topSellers) {
      topSellers.style.display = settings.showTopSellers ? 'block' : 'none';
    }

    // تطبيق الحركات
    if (!settings.showAnimations) {
      document.body.classList.add('no-animations');
    } else {
      document.body.classList.remove('no-animations');
    }

    // تحديث واجهة الإعدادات
    updateStoreSettingsUI(settings);
  }

  function updateStoreSettingsUI(settings) {
    if ($('storeName')) $('storeName').value = settings.storeName;
    if ($('whatsappNumber')) $('whatsappNumber').value = settings.whatsappNumber;
    if ($('storeDescription')) $('storeDescription').value = settings.storeDescription;
    if ($('storeAddress')) $('storeAddress').value = settings.storeAddress;
    if ($('productsPerRow')) $('productsPerRow').value = settings.productsPerRow;
    if ($('fontSize')) $('fontSize').value = settings.fontSize;
    if ($('fontFamily')) $('fontFamily').value = settings.fontFamily;
    if ($('showAnimations')) $('showAnimations').checked = settings.showAnimations;
    if ($('showTopSellers')) $('showTopSellers').checked = settings.showTopSellers;
    if ($('autoOpenCart')) $('autoOpenCart').checked = settings.autoOpenCart;
    if ($('requireLogin')) $('requireLogin').checked = settings.requireLogin;
    if ($('autoLogout')) $('autoLogout').checked = settings.autoLogout;
    if ($('backupToCloud')) $('backupToCloud').checked = settings.backupToCloud;
    if ($('safeDeleteLimit')) $('safeDeleteLimit').value = settings.safeDeleteLimit;
  }

  // إحصائيات المتجر
  function getStoreStatistics() {
    const totalProducts = state.products.length;
    const totalOrders = state.orders.length;
    const totalSales = state.orders.reduce((sum, order) => sum + (order.total || 0), 0);
    
    // إيجاد المنتج الأكثر مبيعاً
    const popularProduct = state.products.reduce((max, product) => {
      return (product.sold || 0) > (max.sold || 0) ? product : max;
    }, { name: 'لا يوجد', sold: 0 });

    return {
      totalProducts,
      totalOrders,
      totalSales: totalSales.toFixed(2),
      popularProduct: popularProduct.name
    };
  }

  function updateStatisticsUI() {
    const stats = getStoreStatistics();
    if ($('statsTotalProducts')) $('statsTotalProducts').textContent = stats.totalProducts;
    if ($('statsTotalOrders')) $('statsTotalOrders').textContent = stats.totalOrders;
    if ($('statsTotalSales')) $('statsTotalSales').textContent = stats.totalSales;
    if ($('statsPopularProduct')) $('statsPopularProduct').textContent = stats.popularProduct;
  }

  // عرض الطلبات
  function renderOrdersList() {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;

    if (state.orders.length === 0) {
      ordersList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">لا توجد طلبات</p>';
      return;
    }

    ordersList.innerHTML = state.orders.map(order => `
      <div style="background: white; padding: 15px; border-radius: var(--radius); margin-bottom: 10px; border: 1px solid #eee;">
        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 10px;">
          <strong>${order.customerName} - ${order.customerPhone}</strong>
          <span style="background: #4caf50; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px;">
            ${(order.total || 0).toFixed(2)} ج.م
          </span>
        </div>
        <div style="font-size: 14px; color: #666;">
          ${order.items.map(item => `${item.name} (${item.qty})`).join('، ')}
        </div>
        <div style="font-size: 12px; color: #999; margin-top: 5px;">
          ${new Date(order.createdAt).toLocaleString('ar-EG')}
        </div>
      </div>
    `).join('');
  }

  // تصدير الطلبات
  function exportOrders() {
    const dataStr = JSON.stringify(state.orders, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders_export_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast('📤 تم تصدير الطلبات بنجاح');
  }

  /* -------------------------
     Firebase Database - النسخة المحسنة والمصلحة
     ------------------------- */
  let db = null;
  let storage = null;
  let firebaseInitialized = false;

  // إعدادات Firebase الافتراضية
  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyA4kp5e0AV13l7_ODW5w4-0spTNGciDl60",
    authDomain: "kongaroo-9c165.firebaseapp.com",
    projectId: "kongaroo-9c165",
    storageBucket: "kongaroo-9c165.firebasestorage.app",
    messagingSenderId: "516454220836",
    appId: "1:516454220836:web:26de429b3562475a2d44b1",
    measurementId: "G-PVZXM83JNQ"
  };

  function initializeFirebase(config) {
    try {
      if (!config.apiKey || !config.projectId) {
        throw new Error('بيانات Firebase غير مكتملة');
      }

      const firebaseConfig = {
        apiKey: config.apiKey,
        authDomain: config.authDomain || `${config.projectId}.firebaseapp.com`,
        projectId: config.projectId,
        storageBucket: config.storageBucket || `${config.projectId}.appspot.com`,
        messagingSenderId: config.messagingSenderId || "123456789",
        appId: config.appId || "1:123456789:web:abcdef123456"
      };

      // Initialize Firebase
      if (firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
      }
      
      // Initialize Cloud Firestore and get a reference to the service
      db = firebase.firestore();
      storage = firebase.storage();
      
      firebaseInitialized = true;
      updateSyncStatus('✅ متصل بقاعدة البيانات', '#28a745');
      
      // تفعيل الاستماع للتغييرات في الوقت الحقيقي
      setupRealtimeListeners();
      
      return true;
    } catch (error) {
      console.error('خطأ في تهيئة Firebase:', error);
      updateSyncStatus('❌ فشل الاتصال: ' + error.message, '#dc3545');
      return false;
    }
  }

  // الاستماع للتغييرات في الوقت الحقيقي من Firebase
  function setupRealtimeListeners() {
    if (!firebaseInitialized || !db) return;

    try {
      // الاستماع للتغييرات في المنتجات
      db.collection('products').onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          const cloudProducts = [];
          snapshot.forEach(doc => {
            cloudProducts.push({ id: doc.id, ...doc.data() });
          });
          
          // تحديث البيانات المحلية فقط إذا كانت مختلفة
          if (JSON.stringify(cloudProducts) !== JSON.stringify(state.products)) {
            state.products = cloudProducts;
            save(LS_KEYS.products, state.products);
            save(LS_KEYS.lastSync, new Date().toISOString());
            
            renderProducts();
            renderAdminProducts();
            showToast('🔄 تم تحديث البيانات من السحابة', 2000);
          }
        }
      }, (error) => {
        console.error('خطأ في الاستماع للتغييرات:', error);
      });

    } catch (error) {
      console.error('خطأ في إعداد المستمعين:', error);
    }
  }

  function updateSyncStatus(message, color = '#dc3545') {
    const statusElement = $('syncStatus');
    if (statusElement) {
      statusElement.innerHTML = `حالة الاتصال: <span style="color: ${color};">${message}</span>`;
    }
  }

  // حفظ البيانات في Firebase أولاً ثم محلياً
  async function saveToFirebase(collection, data, id = null) {
    if (!firebaseInitialized || !db) {
      return { success: false, id: id || uid(), localOnly: true };
    }

    try {
      // نسخة نظيفة من البيانات بدون تواريخ أو دوال
      const firebaseData = JSON.parse(JSON.stringify(data));
      
      // إزالة الحقول التي قد تسبب مشاكل في Firebase
      delete firebaseData.createdAt;
      delete firebaseData.updatedAt;
      delete firebaseData.id;

      let result;
      if (id) {
        await db.collection(collection).doc(id).set({
          ...firebaseData,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        result = { success: true, id };
      } else {
        const docRef = await db.collection(collection).add({
          ...firebaseData,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        result = { success: true, id: docRef.id };
      }
      
      save(LS_KEYS.lastSync, new Date().toISOString());
      return result;
    } catch (error) {
      console.error(`خطأ في حفظ ${collection} في Firebase:`, error);
      return { success: false, id: id || uid(), error: error.message };
    }
  }

  // حفظ المنتج مع المزامنة المزدوجة
  async function saveProduct(product, isNew = false) {
    return await saveProductWithOfflineSupport(product, isNew);
  }

  // حفظ الطلب في Firebase مع المزامنة المزدوجة
  async function saveOrderToFirebase(orderData) {
    const firebaseResult = await saveToFirebase('orders', orderData, orderData.id);
    
    if (firebaseResult.success) {
      if (!state.orders.find(o => o.id === orderData.id)) {
        state.orders.push(orderData);
      }
      save(LS_KEYS.orders, state.orders);
      return firebaseResult.id;
    } else {
      state.orders.push(orderData);
      save(LS_KEYS.orders, state.orders);
      return null;
    }
  }

  // مزامنة جميع البيانات إلى Firebase
  async function syncAllToFirebase() {
    if (!firebaseInitialized || !db) {
      showToast('❌ Firebase غير مهيأ');
      return false;
    }

    try {
      showToast('☁️ جاري مزامنة جميع البيانات...');
      
      // استخدام Batch operations للكتابة الجماعية
      const batch = db.batch();
      
      // مزامنة الأقسام
      const sectionsRef = db.collection('sections');
      state.sections.forEach(section => {
        const docRef = sectionsRef.doc(section.id || uid('sec'));
        batch.set(docRef, {
          ...section,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      
      // مزامنة المنتجات
      const productsRef = db.collection('products');
      state.products.forEach(product => {
        const docRef = productsRef.doc(product.id);
        batch.set(docRef, {
          ...product,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      
      await batch.commit();

      save(LS_KEYS.lastSync, new Date().toISOString());
      showToast('✅ تم مزامنة جميع البيانات إلى السحابة');
      return true;
    } catch (error) {
      console.error('خطأ في مزامنة البيانات:', error);
      showToast('❌ فشل في مزامنة البيانات');
      return false;
    }
  }

  // جلب جميع البيانات من Firebase
  async function syncAllFromFirebase() {
    if (!firebaseInitialized || !db) {
      showToast('❌ Firebase غير مهيأ');
      return false;
    }

    try {
      showToast('📥 جاري جلب البيانات من السحابة...');

      // جلب الأقسام
      const sectionsSnapshot = await db.collection('sections').get();
      if (!sectionsSnapshot.empty) {
        const cloudSections = [];
        sectionsSnapshot.forEach(doc => {
          cloudSections.push(doc.data());
        });
        state.sections = cloudSections;
      }

      // جلب المنتجات
      const productsSnapshot = await db.collection('products').get();
      if (!productsSnapshot.empty) {
        const cloudProducts = [];
        productsSnapshot.forEach(doc => {
          cloudProducts.push({ id: doc.id, ...doc.data() });
        });
        state.products = cloudProducts;
      }

      save(LS_KEYS.sections, state.sections);
      save(LS_KEYS.products, state.products);
      save(LS_KEYS.lastSync, new Date().toISOString());

      renderSections();
      renderProducts();
      renderAdminProducts();
      renderAdminSections();
      
      showToast('✅ تم جلب جميع البيانات من السحابة');
      return true;
    } catch (error) {
      console.error('خطأ في جلب البيانات:', error);
      showToast('❌ فشل في جلب البيانات');
      return false;
    }
  }

  /* -------------------------
     نظام النسخ الاحتياطي التلقائي
     ------------------------- */
  let backupInterval = null;

  function startAutoBackup() {
    if (backupInterval) {
      clearInterval(backupInterval);
    }
    
    backupInterval = setInterval(() => {
      if (state.products.length > 0 || state.sections.length > 0) {
        const success = saveAll();
        if (success) {
          console.log('✅ النسخ الاحتياطي التلقائي - ' + new Date().toLocaleTimeString());
        }
      }
    }, 3 * 60 * 1000);
    
    window.addEventListener('beforeunload', () => {
      if (state.products.length > 0 || state.sections.length > 0) {
        saveAll();
        console.log('💾 نسخ احتياطي نهائي قبل الإغلاق');
      }
    });
  }

  function createDownloadableBackup() {
    const backupData = {
      version: '3.0',
      timestamp: new Date().toISOString(),
      products: state.products,
      sections: state.sections,
      theme: state.theme,
      logo: state.logo,
      customIcons: state.customIcons,
      orders: state.orders
    };
    
    const dataStr = JSON.stringify(backupData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `waha_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast('💾 تم إنشاء نسخة احتياطية قابلة للتحميل');
  }

  function restoreFromBackup(file) {
    if (!file) {
      showToast('اختر ملف النسخة الاحتياطية أولاً');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const backupData = JSON.parse(e.target.result);
        
        if (backupData.version !== '3.0') {
          showToast('❌ إصدار ملف النسخة الاحتياطية غير مدعوم');
          return;
        }
        
        if (confirm('هل تريد استعادة النسخة الاحتياطية؟ سيتم استبدال جميع البيانات الحالية.')) {
          state.products = backupData.products || [];
          state.sections = backupData.sections || [];
          state.theme = backupData.theme || { main: '#ffb300', bg: '#fafafa', text: '#222' };
          state.logo = backupData.logo || 'https://i.postimg.cc/bwGLgnwv/1743204323947.jpg';
          state.customIcons = backupData.customIcons || [];
          state.orders = backupData.orders || [];
          
          saveAll();
          
          applyThemeToUI();
          renderSections();
          renderProducts();
          renderAdminProducts();
          renderAdminSections();
          updateLogoPreview();
          renderCustomIcons();
          renderOrdersList();
          updateStatisticsUI();
          
          showToast('✅ تم استعادة النسخة الاحتياطية بنجاح');
        }
      } catch (error) {
        console.error('خطأ في استعادة النسخة الاحتياطية:', error);
        showToast('❌ ملف النسخة الاحتياطية تالف');
      }
    };
    
    reader.readAsText(file);
  }

  /* -------------------------
     Icons Library
     ------------------------- */
  const ICONS_LIBRARY = [
    "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈",
    "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦",
    "🥬", "🥒", "🌶", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔",
    "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈",
    "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴", "🌭", "🍔", "🍟",
    "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗", "🥘",
    "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪",
    "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧",
    "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫",
    "🍿", "🍩", "🍪", "🌰", "🥜", "🫘", "🍯", "🥛", "🍼", "🫗",
    "☕", "🍵", "🧃", "🥤", "🧋", "🫙", "🍶", "🍺", "🍻", "🥂",
    "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊", "🥄", "🍴", "🍽",
    "🥣", "🥡", "🥢", "🧂", "🛒", "📦", "💰", "⭐", "❤️", "🔥"
  ];

  /* -------------------------
     Password Management
     ------------------------- */
  let ADMIN_PASS = '102030';

  function changeAdminPassword(currentPass, newPass, confirmPass) {
    if (currentPass !== ADMIN_PASS) {
      return 'كلمة المرور الحالية غير صحيحة';
    }
    
    if (newPass.length < 4) {
      return 'كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل';
    }
    
    if (newPass !== confirmPass) {
      return 'كلمات المرور غير متطابقة';
    }
    
    ADMIN_PASS = newPass;
    return null;
  }

  /* -------------------------
     DOM references
     ------------------------- */
  const elements = {
    // العناصر الأساسية
    bannerTrack: $('metro'),
    searchInput: $('searchInput'),
    sectionList: $('sectionList'),
    productGrid: $('productGrid'),
    cartSidebar: $('cartSidebar'),
    cartItemsEl: $('cartItems'),
    cartTotalEl: $('cartTotal'),
    cartCountBadge: $('cartCount'),
    clearCartBtn: $('clearCartBtn'),
    closeCartBtn: $('closeCart'),
    checkoutBtn: $('checkoutBtn'),
    cartWhatsappBtn: $('cartWhatsappBtn'),
    
    // النوافذ المنبثقة
    passwordModal: $('passwordModal'),
    adminPassword: $('adminPassword'),
    passwordSubmit: $('passwordSubmit'),
    passwordCancel: $('passwordCancel'),
    settingsModal: $('settingsModal'),
    closeSettings: $('closeSettings'),
    editProductModal: $('editProductModal'),
    editName: $('editName'),
    editPrice: $('editPrice'),
    editSection: $('editSection'),
    editImage: $('editImage'),
    editPreview: $('editPreview'),
    saveEditBtn: $('saveEditBtn'),
    cancelEditBtn: $('cancelEditBtn'),
    checkoutModal: $('checkoutModal'),
    checkoutSummary: $('checkoutSummary'),
    checkoutName: $('checkoutName'),
    checkoutPhone: $('checkoutPhone'),
    confirmCheckout: $('confirmCheckout'),
    cancelCheckout: $('cancelCheckout'),
    iconsModal: $('iconsModal'),
    iconsSearch: $('iconsSearch'),
    iconsGrid: $('iconsGrid'),
    closeIconsModal: $('closeIconsModal'),
    
    // إدارة المنتجات
    addProductBtn: $('addProductBtn'),
    deleteAllProductsBtn: $('deleteAllProducts'),
    adminProducts: $('adminProducts'),
    newSectionName: $('newSectionName'),
    newSectionIcon: $('newSectionIcon'),
    addSectionBtn: $('addSectionBtn'),
    adminSections: $('adminSections'),
    openIconsModal: $('openIconsModal'),
    
    // الألوان واللوجو
    mainColor: $('mainColor'),
    bgColor: $('bgColor'),
    textColor: $('textColor'),
    applyTheme: $('applyTheme'),
    resetTheme: $('resetTheme'),
    logoPreview: $('logoPreview'),
    logoUpload: $('logoUpload'),
    uploadLogoBtn: $('uploadLogoBtn'),
    logoUrl: $('logoUrl'),
    applyLogoUrl: $('applyLogoUrl'),
    resetLogo: $('resetLogo'),
    iconUpload: $('iconUpload'),
    uploadIconBtn: $('uploadIconBtn'),
    customIconsGrid: $('customIconsGrid'),
    iconUploadModal: $('iconUploadModal'),
    uploadIconModalBtn: $('uploadIconModalBtn'),
    
    // كلمة المرور
    currentPassword: $('currentPassword'),
    newPassword: $('newPassword'),
    confirmPassword: $('confirmPassword'),
    changePasswordBtn: $('changePasswordBtn'),
    
    // عناصر التحكم
    zoomIn: $('zoomIn'),
    zoomOut: $('zoomOut'),
    zoomLevelEl: $('zoomLevel'),
    themeToggle: $('themeToggle'),
    siteLogo: $('siteLogo'),
    cartBtn: $('cartBtn'),
    settingsBtn: $('settingsBtn'),
    adminControls: $('adminControls'),
    toggleAdminView: $('toggleAdminView'),
    adminProductControls: $('adminProductControls'),
    addProductMain: $('addProductMain'),
    deleteAllProductsMain: $('deleteAllProductsMain'),
    
    // قاعدة البيانات
    firebaseApiKey: $('firebaseApiKey'),
    firebaseProjectId: $('firebaseProjectId'),
    firebaseAuthDomain: $('firebaseAuthDomain'),
    saveFirebaseConfig: $('saveFirebaseConfig'),
    testFirebaseConnection: $('testFirebaseConnection'),
    syncToCloud: $('syncToCloud'),
    syncFromCloud: $('syncFromCloud'),
    clearLocalData: $('clearLocalData'),
    syncStatus: $('syncStatus'),
    
    // النسخ الاحتياطي
    createBackup: $('createBackup'),
    autoBackupToggle: $('autoBackupToggle'),
    backupFile: $('backupFile'),
    restoreBackup: $('restoreBackup'),
    
    // إعدادات المتجر
    storeName: $('storeName'),
    whatsappNumber: $('whatsappNumber'),
    storeDescription: $('storeDescription'),
    storeAddress: $('storeAddress'),
    saveStoreSettings: $('saveStoreSettings'),
    productsPerRow: $('productsPerRow'),
    fontSize: $('fontSize'),
    fontFamily: $('fontFamily'),
    showAnimations: $('showAnimations'),
    showTopSellers: $('showTopSellers'),
    autoOpenCart: $('autoOpenCart'),
    applyUISettings: $('applyUISettings'),
    refreshOrders: $('refreshOrders'),
    exportOrders: $('exportOrders'),
    generateReport: $('generateReport'),
    requireLogin: $('requireLogin'),
    autoLogout: $('autoLogout'),
    backupToCloud: $('backupToCloud'),
    safeDeleteLimit: $('safeDeleteLimit'),
    saveSecuritySettings: $('saveSecuritySettings'),
    
    // الإحصائيات
    statsTotalProducts: $('statsTotalProducts'),
    statsTotalOrders: $('statsTotalOrders'),
    statsTotalSales: $('statsTotalSales'),
    statsPopularProduct: $('statsPopularProduct'),
    
    // المهام المؤجلة
    processQueueNow: $('processQueueNow'),
    clearQueue: $('clearQueue'),
    queueCount: $('queueCount'),
    connectionStatusText: $('connectionStatusText'),
    offlineQueueList: $('offlineQueueList'),
    
    // التقارير
    generateMonthlyReport: $('generateMonthlyReport'),
    exportPDF: $('exportPDF'),
    salesReport: $('salesReport'),
    inventoryReport: $('inventoryReport'),
    
    // الخصومات
    discountName: $('discountName'),
    discountType: $('discountType'),
    discountValue: $('discountValue'),
    addDiscountBtn: $('addDiscountBtn'),
    activeDiscountsList: $('activeDiscountsList')
  };

  /* -------------------------
     App state
     ------------------------- */
  let adminMode = false;
  
  let state = {
    sections: load(LS_KEYS.sections, [
      { name: "الشيكولاتة", icon: "🍫" },
      { name: "أرز بسمتي", icon: "🍚" },
      { name: "شوفان", icon: "🥣" },
      { name: "صوص حلويات", icon: "🍯" },
      { name: "صوص الطعام", icon: "🥫" },
      { name: "كرسبي وبقسماط", icon: "🍗" },
      { name: "زيت الزيتون", icon: "🫒" }
    ]),
    products: load(LS_KEYS.products, [
      {
        id: uid('p'),
        name: "شوفان لينو جبه كامله",
        price: 60,
        section: "شوفان", 
        image: "https://i.postimg.cc/4x2p9kFz/oats.jpg",
        sold: 2
      },
      {
        id: uid('p'),
        name: "رز هندي استار",
        price: 90, 
        section: "أرز بسمتي",
        image: "https://i.postimg.cc/9Fv9V2yJ/indian-rice.jpg",
        sold: 5
      },
      {
        id: uid('p'),
        name: "زبدة فول كريمي",
        price: 65,
        section: "الشيكولاتة",
        image: "https://i.postimg.cc/8kKfYj3b/peanut.jpg", 
        sold: 1
      }
    ]),
    cart: load(LS_KEYS.cart, []),
    theme: load(LS_KEYS.theme, { main: '#ffb300', bg: '#fafafa', text: '#222' }),
    darkMode: localStorage.getItem(LS_KEYS.dark) === 'true',
    zoom: 1,
    editingProductId: null,
    logo: load(LS_KEYS.logo, 'https://i.postimg.cc/bwGLgnwv/1743204323947.jpg'),
    customIcons: load(LS_KEYS.customIcons, []),
    orders: load(LS_KEYS.orders, []),
    firebaseConfig: load(LS_KEYS.firebaseConfig, DEFAULT_FIREBASE_CONFIG),
    lastSync: load(LS_KEYS.lastSync, null),
    reviews: load(LS_KEYS.reviews, {}),
    discounts: load(LS_KEYS.discounts, [])
  };

  /* -------------------------
     Save utility - النسخة المحسنة
     ------------------------- */
  function saveAll() {
    const success = 
      save(LS_KEYS.sections, state.sections) &&
      save(LS_KEYS.products, state.products) &&
      save(LS_KEYS.cart, state.cart) &&
      save(LS_KEYS.theme, state.theme) &&
      save(LS_KEYS.logo, state.logo) &&
      save(LS_KEYS.customIcons, state.customIcons) &&
      save(LS_KEYS.orders, state.orders) &&
      save(LS_KEYS.firebaseConfig, state.firebaseConfig) &&
      save(LS_KEYS.reviews, state.reviews) &&
      save(LS_KEYS.discounts, state.discounts);
    
    localStorage.setItem(LS_KEYS.dark, state.darkMode ? 'true' : 'false');
    return success;
  }

  // حفظ القسم مع المزامنة
  async function saveSection(section, isNew = false) {
    let sectionToSave = { ...section };
    
    if (isNew) {
      sectionToSave.id = uid('sec');
      state.sections.push(sectionToSave);
    } else {
      state.sections = state.sections.map(s => s.id === sectionToSave.id ? sectionToSave : s);
    }
    
    save(LS_KEYS.sections, state.sections);
    
    if (firebaseInitialized) {
      try {
        await saveToFirebase('sections', sectionToSave, sectionToSave.id);
      } catch (error) {
        console.error('خطأ في مزامنة القسم:', error);
      }
    }
    
    return true;
  }

  // حذف القسم مع المزامنة
  async function deleteSection(sectionId) {
    const sectionName = state.sections.find(s => s.id === sectionId)?.name;
    
    state.sections = state.sections.filter(s => s.id !== sectionId);
    state.products = state.products.filter(p => p.section !== sectionName);
    
    save(LS_KEYS.sections, state.sections);
    save(LS_KEYS.products, state.products);
    
    if (firebaseInitialized) {
      try {
        await db.collection('sections').doc(sectionId).delete();
      } catch (error) {
        console.error('خطأ في مزامنة حذف القسم:', error);
      }
    }
    
    return true;
  }

  /* -------------------------
     Apply theme/dark/zoom/logo
     ------------------------- */
  function applyThemeToUI() {
    const root = document.documentElement;
    root.style.setProperty('--main-color', state.theme.main);
    root.style.setProperty('--bg-color', state.theme.bg);
    root.style.setProperty('--text-color', state.theme.text);
    
    document.body.style.background = state.theme.bg;
    document.body.style.color = state.theme.text;
    
    if (elements.mainColor) elements.mainColor.value = state.theme.main;
    if (elements.bgColor) elements.bgColor.value = state.theme.bg;
    if (elements.textColor) elements.textColor.value = state.theme.text;
  }

  function applyDark() {
    document.body.classList.toggle('dark', state.darkMode);
  }

  function applyZoom() {
    document.body.style.transform = `scale(${state.zoom})`;
    document.body.style.transformOrigin = 'top right';
    if (elements.zoomLevelEl) {
      elements.zoomLevelEl.textContent = Math.round(state.zoom * 100) + '%';
    }
  }

  function updateLogoPreview() {
    const logoPreview = $('#logoPreview');
    const siteLogo = $('#siteLogo');
    
    if (logoPreview) {
      logoPreview.src = state.logo;
    }
    
    if (siteLogo) {
      siteLogo.src = state.logo;
    }
  }

  function changeLogo(newLogoUrl) {
    if (!newLogoUrl) return;
    
    state.logo = newLogoUrl;
    save(LS_KEYS.logo, state.logo);
    updateLogoPreview();
    showToast('✅ تم تغيير الشعار بنجاح');
  }

  function resetLogo() {
    const defaultLogo = 'https://i.postimg.cc/bwGLgnwv/1743204323947.jpg';
    state.logo = defaultLogo;
    save(LS_KEYS.logo, state.logo);
    updateLogoPreview();
    showToast('🔄 تم استعادة الشعار الأصلي');
  }

  /* -------------------------
     Custom Icons Management
     ------------------------- */
  function uploadCustomIcon(file, source = 'settings') {
    if (!file) {
      showToast('اختر صورة أولاً');
      return;
    }
    
    if (!file.type.startsWith('image/')) {
      showToast('الرجاء اختيار ملف صورة');
      return;
    }
    
    if (file.size > 1 * 1024 * 1024) {
      showToast('حجم الصورة كبير جداً (الحد الأقصى 1MB)');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const iconData = {
        id: uid('icon'),
        data: e.target.result,
        name: file.name,
        uploadedAt: new Date().toISOString()
      };
      
      state.customIcons.unshift(iconData);
      saveAll();
      
      if (source === 'settings') {
        renderCustomIcons();
      } else if (source === 'modal') {
        renderIconsGrid([...ICONS_LIBRARY, ...state.customIcons.map(icon => icon.data)]);
      }
      
      showToast('✅ تم رفع الأيقونة بنجاح');
    };
    
    reader.onerror = function() {
      showToast('❌ فشل في رفع الأيقونة');
    };
    
    reader.readAsDataURL(file);
  }

  function renderCustomIcons() {
    if (!elements.customIconsGrid) return;
    
    elements.customIconsGrid.innerHTML = '';
    
    if (state.customIcons.length === 0) {
      elements.customIconsGrid.innerHTML = `
        <p style="text-align:center; color:#666; padding:20px;">
          لا توجد أيقونات مرفوعة
        </p>
      `;
      return;
    }
    
    state.customIcons.forEach((icon, index) => {
      const iconElement = document.createElement('div');
      iconElement.className = 'custom-icon-item';
      iconElement.innerHTML = `<img src="${icon.data}" alt="${icon.name}">`;
      
      iconElement.addEventListener('click', () => {
        const newSectionIcon = $('newSectionIcon');
        if (newSectionIcon) {
          newSectionIcon.value = icon.data;
          showToast('✅ تم اختيار الأيقونة');
        }
      });
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn secondary small';
      deleteBtn.innerHTML = '🗑️';
      deleteBtn.style.position = 'absolute';
      deleteBtn.style.top = '-5px';
      deleteBtn.style.left = '-5px';
      deleteBtn.style.padding = '2px 6px';
      deleteBtn.style.fontSize = '10px';
      
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('هل تريد حذف هذه الأيقونة؟')) {
          state.customIcons.splice(index, 1);
          saveAll();
          renderCustomIcons();
          showToast('🗑️ تم حذف الأيقونة');
        }
      });
      
      iconElement.style.position = 'relative';
      iconElement.appendChild(deleteBtn);
      elements.customIconsGrid.appendChild(iconElement);
    });
  }

  /* -------------------------
     واجهة إدارة المهام المؤجلة
     ------------------------- */
  function updateOfflineQueueUI() {
    const queue = loadOfflineQueue();
    const queueCount = document.getElementById('queueCount');
    const connectionStatusText = document.getElementById('connectionStatusText');
    const queueList = document.getElementById('offlineQueueList');
    
    if (queueCount) queueCount.textContent = queue.length;
    
    if (connectionStatusText) {
      connectionStatusText.textContent = isOnline ? '🌐 متصل بالإنترنت' : '⚠️ غير متصل';
      connectionStatusText.style.color = isOnline ? '#4caf50' : '#ff9800';
    }
    
    if (queueList) {
      if (queue.length === 0) {
        queueList.innerHTML = `
          <div style="text-align: center; color: #666; padding: 20px;">
            لا توجد مهام في قائمة الانتظار
          </div>
        `;
      } else {
        queueList.innerHTML = queue.map(item => `
          <div style="background: white; padding: 10px; border-radius: var(--radius); margin-bottom: 8px; border: 1px solid #eee; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>${getActionName(item.action)}</strong>
              <span style="color: #666; font-size: 10px;">${new Date(item.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style="color: #666; margin-top: 4px;">${getActionDescription(item.data, item.action)}</div>
            ${item.attempts > 0 ? `<div style="color: #ff9800; font-size: 10px;">محاولة: ${item.attempts}</div>` : ''}
          </div>
        `).join('');
      }
    }
  }

  function getActionName(action) {
    const actions = {
      'ADD_PRODUCT': 'إضافة منتج',
      'UPDATE_PRODUCT': 'تعديل منتج',
      'DELETE_PRODUCT': 'حذف منتج',
      'ADD_SECTION': 'إضافة قسم',
      'UPDATE_SECTION': 'تعديل قسم',
      'DELETE_SECTION': 'حذف قسم',
      'ADD_ORDER': 'إضافة طلب'
    };
    return actions[action] || action;
  }

  function getActionDescription(data, action) {
    switch (action) {
      case 'ADD_PRODUCT':
      case 'UPDATE_PRODUCT':
        return `📦 ${data.name} - ${data.price} ج.م`;
      case 'DELETE_PRODUCT':
        return `🗑️ منتج #${data.id}`;
      case 'ADD_SECTION':
      case 'UPDATE_SECTION':
        return `📂 ${data.name} ${data.icon}`;
      case 'DELETE_SECTION':
        return `🗑️ قسم #${data.id}`;
      case 'ADD_ORDER':
        return `🧾 طلب من ${data.customerName}`;
      default:
        return JSON.stringify(data);
    }
  }

  // معالجة يدوية للمهام المؤجلة
  async function processQueueManually() {
    if (!isOnline) {
      showToast('❌ لا يوجد اتصال بالإنترنت');
      return;
    }
    
    const queue = loadOfflineQueue();
    if (queue.length === 0) {
      showToast('✅ لا توجد مهام في قائمة الانتظار');
      return;
    }
    
    showToast('🔄 جاري معالجة المهام يدوياً...');
    await processOfflineQueue();
    updateOfflineQueueUI();
  }

  // مسح قائمة الانتظار
  function clearOfflineQueue() {
    const queue = loadOfflineQueue();
    if (queue.length === 0) {
      showToast('✅ القائمة فارغة بالفعل');
      return;
    }
    
    if (confirm(`هل تريد مسح ${queue.length} مهمة من قائمة الانتظار؟`)) {
      save(OFFLINE_QUEUE_KEY, []);
      updateOfflineQueueUI();
      showToast('🗑️ تم مسح قائمة الانتظار');
    }
  }

  /* -------------------------
     Admin Mode Toggle
     ------------------------- */
  function toggleAdminMode() {
    adminMode = !adminMode;
    
    if (elements.adminControls) {
      elements.adminControls.style.display = adminMode ? 'block' : 'none';
    }
    
    if (elements.adminProductControls) {
      elements.adminProductControls.style.display = adminMode ? 'flex' : 'none';
    }
    
    if (elements.toggleAdminView) {
      elements.toggleAdminView.textContent = adminMode ? '👁️ إخفاء وضع المسؤول' : '👁️ وضع المسؤول';
      elements.toggleAdminView.classList.toggle('active', adminMode);
    }
    
    const activeSection = elements.sectionList?.querySelector('.section-btn.active');
    const currentSection = activeSection?.dataset.section;
    const searchTerm = elements.searchInput?.value || '';
    
    renderProducts(
      currentSection && currentSection !== 'ALL' ? currentSection : null,
      searchTerm
    );
    
    showToast(adminMode ? '🔓 تم تفعيل وضع المسؤول' : '🔒 تم إيقاف وضع المسؤول');
  }

  /* -------------------------
     Icons Modal Management
     ------------------------- */
  function openIconsModal(currentIcon = '') {
    const iconsModal = $('iconsModal');
    const iconsGrid = $('iconsGrid');
    const iconsSearch = $('iconsSearch');
    
    if (!iconsModal || !iconsGrid) return;
    
    renderIconsGrid([...ICONS_LIBRARY, ...state.customIcons.map(icon => icon.data)]);
    
    iconsModal.classList.add('show');
    
    if (iconsSearch) {
      iconsSearch.value = '';
      iconsSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const allIcons = [...ICONS_LIBRARY, ...state.customIcons.map(icon => icon.data)];
        const filteredIcons = allIcons.filter(icon => 
          icon.toLowerCase().includes(searchTerm)
        );
        renderIconsGrid(filteredIcons);
      });
    }
    
    if (currentIcon) {
      setTimeout(() => {
        const currentIconElement = iconsGrid.querySelector(`[data-icon="${currentIcon}"]`);
        if (currentIconElement) {
          currentIconElement.classList.add('selected');
        }
      }, 100);
    }
  }

  function renderIconsGrid(icons) {
    const iconsGrid = $('iconsGrid');
    if (!iconsGrid) return;
    
    iconsGrid.innerHTML = '';
    
    icons.forEach(icon => {
      const iconElement = document.createElement('div');
      iconElement.className = 'icon-item';
      
      if (icon.startsWith('data:image') || icon.startsWith('http')) {
        iconElement.innerHTML = `<img src="${icon}" style="width:100%; height:100%; object-fit:cover;">`;
      } else {
        iconElement.textContent = icon;
      }
      
      iconElement.dataset.icon = icon;
      
      iconElement.addEventListener('click', () => {
        iconsGrid.querySelectorAll('.icon-item').forEach(item => {
          item.classList.remove('selected');
        });
        
        iconElement.classList.add('selected');
        
        const newSectionIcon = $('newSectionIcon');
        if (newSectionIcon) {
          newSectionIcon.value = icon;
        }
        
        setTimeout(() => {
          closeIconsModal();
        }, 300);
      });
      
      iconsGrid.appendChild(iconElement);
    });
  }

  function closeIconsModal() {
    const iconsModal = $('iconsModal');
    if (iconsModal) {
      iconsModal.classList.remove('show');
    }
  }

  /* -------------------------
     Rendering functions
     ------------------------- */
  function fillSectionSelects() {
    const selects = [elements.editSection].filter(Boolean);
    
    selects.forEach(select => {
      if (!select) return;
      
      select.innerHTML = '';
      
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'اختر القسم';
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);
      
      state.sections.forEach(section => {
        const option = document.createElement('option');
        option.value = section.name;
        option.textContent = `${section.icon} ${section.name}`;
        select.appendChild(option);
      });
    });
  }

  function renderSections() {
    if (!elements.sectionList) return;
    
    elements.sectionList.innerHTML = '';
    
    const allBtn = document.createElement('button');
    allBtn.className = 'section-btn active';
    allBtn.type = 'button';
    allBtn.dataset.section = 'ALL';
    allBtn.innerHTML = '🏪 الكل';
    allBtn.addEventListener('click', () => {
      qa('.section-btn').forEach(btn => btn.classList.remove('active'));
      allBtn.classList.add('active');
      renderProducts();
    });
    elements.sectionList.appendChild(allBtn);
    
    state.sections.forEach(section => {
      const btn = document.createElement('button');
      btn.className = 'section-btn';
      btn.type = 'button';
      btn.innerHTML = `${section.icon} ${section.name}`;
      btn.dataset.section = section.name;
      btn.addEventListener('click', () => {
        qa('.section-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderProducts(section.name);
      });
      elements.sectionList.appendChild(btn);
    });
    
    fillSectionSelects();
  }

  function renderProducts(filterSection = null, searchTerm = '') {
    if (!elements.productGrid) return;
    
    elements.productGrid.innerHTML = '';
    
    let filteredProducts = state.products.filter(product => {
      const matchesSection = !filterSection || filterSection === 'ALL' || product.section === filterSection;
      const matchesSearch = !searchTerm || product.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSection && matchesSearch;
    });
    
    if (filteredProducts.length === 0) {
      elements.productGrid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; color:#777; padding:40px 20px;">
          <p>لا توجد منتجات</p>
          ${searchTerm ? `<p>لم يتم العثور على منتجات تطابق "${searchTerm}"</p>` : ''}
        </div>
      `;
      return;
    }
    
    filteredProducts.forEach(product => {
      const card = document.createElement('div');
      card.className = `product-card ${adminMode ? 'admin-mode' : ''}`;
      
      card.innerHTML = `
        <img src="${product.image || 'https://via.placeholder.com/400x300?text=No+Image'}" 
             alt="${product.name}" 
             loading="lazy">
        <h4>${product.name}</h4>
        <p class="price">${Number(product.price).toFixed(2)} ج.م</p>
        <button class="add-to-cart" type="button" data-id="${product.id}">
          أضف للسلة 🛒
        </button>
        
        ${adminMode ? `
          <div class="product-actions">
            <button class="btn edit product-edit" type="button" data-id="${product.id}">
              ✏️ تعديل
            </button>
            <button class="btn secondary product-delete" type="button" data-id="${product.id}">
              🗑️ حذف
            </button>
          </div>
        ` : ''}
      `;
      
      const addToCartBtn = card.querySelector('.add-to-cart');
      if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () => addToCart(product.id));
      }
      
      if (adminMode) {
        const editBtn = card.querySelector('.product-edit');
        const deleteBtn = card.querySelector('.product-delete');
        
        if (editBtn) {
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(product.id);
          });
        }
        
        if (deleteBtn) {
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`هل تريد حذف المنتج "${product.name}"؟`)) {
              deleteProduct(product.id);
            }
          });
        }
      }
      
      elements.productGrid.appendChild(card);
    });
  }

  // حذف المنتج مع المزامنة
  async function deleteProduct(productId) {
    await deleteProductWithOfflineSupport(productId);
  }

  function updateMetro() {
    if (!elements.bannerTrack) return;
    
    const topProducts = state.products
      .slice()
      .sort((a, b) => (b.sold || 0) - (a.sold || 0))
      .slice(0, 8);
    
    if (topProducts.length === 0) {
      elements.bannerTrack.innerHTML = `
        <div style="padding:20px; text-align:center; color:#777;">
          لا توجد منتجات مميزة
        </div>
      `;
      return;
    }
    
    const itemsHtml = topProducts.map(product => `
      <div class="metro-item">
        <img src="${product.image || 'https://via.placeholder.com/400x300?text=No+Image'}" 
             alt="${product.name}"
             loading="lazy">
        <div style="text-align:center; margin-top:8px; font-size:14px; font-weight:bold;">
          ${product.name}
        </div>
      </div>
    `).join('');
    
    elements.bannerTrack.innerHTML = itemsHtml + itemsHtml;
  }

  /* -------------------------
     Admin functions
     ------------------------- */
  function renderAdminProducts() {
    if (!elements.adminProducts) return;
    
    elements.adminProducts.innerHTML = '';
    
    if (state.products.length === 0) {
      elements.adminProducts.innerHTML = `
        <p style="text-align:center; color:#666; padding:20px;">
          لا توجد منتجات
        </p>
      `;
      return;
    }
    
    state.products.forEach(product => {
      const card = document.createElement('div');
      card.className = 'admin-product-card';
      card.innerHTML = `
        <img src="${product.image || 'https://via.placeholder.com/400x300?text=No+Image'}" 
             alt="${product.name}">
        <div style="padding:8px 0;">
          <strong>${product.name}</strong>
        </div>
        <div>${Number(product.price).toFixed(2)} ج.م • ${product.section || ''}</div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
          <button class="btn edit admin-edit" type="button" data-id="${product.id}">
            ✏️ تعديل
          </button>
          <button class="btn secondary admin-delete" type="button" data-id="${product.id}">
            🗑️ حذف
          </button>
        </div>
      `;
      
      elements.adminProducts.appendChild(card);
    });
    
    qa('.admin-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const productId = e.currentTarget.dataset.id;
        openEditModal(productId);
      });
    });
    
    qa('.admin-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const productId = e.currentTarget.dataset.id;
        if (confirm('هل تريد حذف هذا المنتج؟')) {
          deleteProduct(productId);
        }
      });
    });
  }

  function renderAdminSections() {
    if (!elements.adminSections) return;
    
    elements.adminSections.innerHTML = '';
    
    state.sections.forEach((section, index) => {
      const row = document.createElement('div');
      row.className = 'section-row';
      row.innerHTML = `
        <div class="section-icon-preview">${section.icon}</div>
        <input type="text" value="${section.name}" style="flex:1;" placeholder="اسم القسم">
        <input type="text" value="${section.icon}" class="section-icon-input" placeholder="أيقونة" maxlength="2">
        <div style="display:flex; gap:8px;">
          <button class="btn edit-sec" type="button">✏️</button>
          <button class="btn secondary delete-sec" type="button">🗑️</button>
        </div>
      `;
      
      const nameInput = row.querySelector('input[type="text"]:first-child');
      const iconInput = row.querySelector('.section-icon-input');
      const editBtn = row.querySelector('.edit-sec');
      const deleteBtn = row.querySelector('.delete-sec');
      const iconPreview = row.querySelector('.section-icon-preview');
      
      if (iconInput) {
        iconInput.addEventListener('input', () => {
          if (iconPreview) {
            iconPreview.textContent = iconInput.value || '❓';
          }
        });
      }
      
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          const newName = nameInput ? nameInput.value.trim() : '';
          const newIcon = iconInput ? iconInput.value.trim() : '';
          
          if (!newName) {
            if (nameInput) nameInput.value = section.name;
            showToast('اسم القسم لا يمكن أن يكون فارغ');
            return;
          }
          
          const oldName = state.sections[index].name;
          const updatedSection = {
            name: newName,
            icon: newIcon || '❓'
          };
          
          state.sections[index] = updatedSection;
          
          state.products.forEach(product => {
            if (product.section === oldName) {
              product.section = newName;
            }
          });
          
          saveSection(updatedSection, false);
          save(LS_KEYS.products, state.products);
          
          renderSections();
          renderProducts();
          renderAdminProducts();
          renderAdminSections();
          showToast('✏️ تم تعديل القسم');
        });
      }
      
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          if (confirm('هل تريد حذف هذا القسم؟ سيتم حذف المنتجات التابعة له')) {
            const sectionName = state.sections[index].name;
            deleteSection(section.id || uid('sec'));
            
            renderSections();
            renderProducts();
            renderAdminProducts();
            renderAdminSections();
            showToast('🗑️ تم حذف القسم ومنتجاته');
            playSound('delete');
          }
        });
      }
      
      elements.adminSections.appendChild(row);
    });
  }

  /* -------------------------
     Edit/Add product modal - النسخة المحسنة
     ------------------------- */
  function openEditModal(productId = null) {
    state.editingProductId = productId;
    
    fillSectionSelects();
    if (elements.editPreview) {
      elements.editPreview.style.display = 'none';
      elements.editPreview.src = '';
    }
    
    if (productId) {
      const product = state.products.find(p => p.id === productId);
      if (!product) return;
      
      if (elements.editName) elements.editName.value = product.name;
      if (elements.editPrice) elements.editPrice.value = product.price;
      if (elements.editSection) elements.editSection.value = product.section || '';
      
      if (product.image && elements.editPreview) {
        elements.editPreview.src = product.image;
        elements.editPreview.style.display = 'block';
      }
    } else {
      if (elements.editName) elements.editName.value = '';
      if (elements.editPrice) elements.editPrice.value = '';
      if (elements.editSection) elements.editSection.value = '';
      if (elements.editImage) elements.editImage.value = '';
    }
    
    if (elements.editProductModal) {
      elements.editProductModal.classList.add('show');
    }
  }

  if (elements.editImage) {
    elements.editImage.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) {
        if (elements.editPreview) {
          elements.editPreview.style.display = 'none';
          elements.editPreview.src = '';
        }
        return;
      }
      
      if (!file.type.startsWith('image/')) {
        showToast('الرجاء اختيار ملف صورة');
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        showToast('حجم الصورة كبير جداً (الحد الأقصى 5MB)');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (elements.editPreview) {
          elements.editPreview.src = ev.target.result;
          elements.editPreview.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (elements.saveEditBtn) {
    elements.saveEditBtn.addEventListener('click', async () => {
      const name = elements.editName ? elements.editName.value.trim() : '';
      const price = elements.editPrice ? parseFloat(elements.editPrice.value) : 0;
      const section = elements.editSection ? elements.editSection.value : '';
      
      if (!name) return showToast('أدخل اسم المنتج');
      if (!price || price <= 0) return showToast('أدخل سعراً صحيحاً');
      if (!section) return showToast('اختر قسم للمنتج');
      
      const file = elements.editImage ? elements.editImage.files?.[0] : null;
      
      if (state.editingProductId) {
        const product = state.products.find(p => p.id === state.editingProductId);
        if (!product) return;
        
        const updatedProduct = {
          ...product,
          name,
          price,
          section
        };
        
        if (file) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            updatedProduct.image = e.target.result;
            const result = await saveProduct(updatedProduct, false);
            finalizeProductUpdate(result);
          };
          reader.readAsDataURL(file);
        } else {
          const result = await saveProduct(updatedProduct, false);
          finalizeProductUpdate(result);
        }
      } else {
        const newProduct = {
          id: uid('p'),
          name,
          price,
          section,
          image: 'https://via.placeholder.com/400x300?text=No+Image',
          sold: 0
        };
        
        if (file) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            newProduct.image = e.target.result;
            const result = await saveProduct(newProduct, true);
            finalizeProductUpdate(result);
          };
          reader.readAsDataURL(file);
        } else {
          const result = await saveProduct(newProduct, true);
          finalizeProductUpdate(result);
        }
      }
      
      function finalizeProductUpdate(result) {
        renderProducts();
        renderAdminProducts();
        
        if (result.fromCloud) {
          showToast(result.localOnly ? '✅ تمت إضافة المنتج (محلي)' : '✅ تمت إضافة المنتج في السحابة');
        } else {
          showToast('✅ تمت إضافة المنتج (محلي فقط)');
        }
        
        playSound('add');
        
        if (elements.editProductModal) {
          elements.editProductModal.classList.remove('show');
        }
      }
    });
  }

  if (elements.cancelEditBtn) {
    elements.cancelEditBtn.addEventListener('click', () => {
      if (elements.editProductModal) {
        elements.editProductModal.classList.remove('show');
      }
    });
  }

  /* -------------------------
     Cart functionality
     ------------------------- */
  function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    
    const existingItem = state.cart.find(item => item.id === productId);
    
    if (existingItem) {
      existingItem.qty++;
    } else {
      state.cart.push({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        image: product.image || 'https://via.placeholder.com/400x300?text=No+Image',
        qty: 1
      });
    }
    
    product.sold = (product.sold || 0) + 1;
    
    saveAll();
    renderCart();
    playSound('add');
    showToast(`✅ تمت إضافة ${product.name}`);
    
    // فتح السلة تلقائياً إذا كان الإعداد مفعلاً
    const storeSettings = loadStoreSettings();
    if (storeSettings.autoOpenCart && elements.cartSidebar) {
      elements.cartSidebar.classList.add('active');
    }
  }

  function renderCart() {
    if (!elements.cartItemsEl) return;
    
    elements.cartItemsEl.innerHTML = '';
    
    if (state.cart.length === 0) {
      elements.cartItemsEl.innerHTML = `
        <p style="text-align:center; color:#666; margin:40px 20px;">
          السلة فارغة
        </p>
      `;
      
      if (elements.cartTotalEl) elements.cartTotalEl.textContent = '0.00';
      if (elements.cartCountBadge) elements.cartCountBadge.textContent = '0';
      return;
    }
    
    let total = 0;
    
    state.cart.forEach((item, index) => {
      total += item.price * item.qty;
      
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <img src="${item.image}" alt="${item.name}">
        <div style="flex:1;">
          <strong>${item.name}</strong>
          <div class="qty-controls">
            <button class="minus small" type="button" data-index="${index}">−</button>
            <span class="qty">${item.qty}</span>
            <button class="plus small" type="button" data-index="${index}">+</button>
          </div>
          <div class="price">${(item.price * item.qty).toFixed(2)} ج.م</div>
        </div>
        <button class="small remove" type="button" data-index="${index}">✖</button>
      `;
      
      elements.cartItemsEl.appendChild(row);
    });
    
    if (elements.cartTotalEl) elements.cartTotalEl.textContent = total.toFixed(2);
    if (elements.cartCountBadge) {
      elements.cartCountBadge.textContent = state.cart.reduce((sum, item) => sum + item.qty, 0);
    }
    
    qa('.plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        state.cart[index].qty++;
        saveAll();
        renderCart();
      });
    });
    
    qa('.minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        if (state.cart[index].qty > 1) {
          state.cart[index].qty--;
          saveAll();
          renderCart();
        } else {
          if (confirm('الكمية ستصبح صفر — حذف المنتج؟')) {
            state.cart.splice(index, 1);
            saveAll();
            renderCart();
            playSound('delete');
            showToast('🗑️ حُذف من السلة');
          }
        }
      });
    });
    
    qa('.remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        if (confirm('حذف هذا المنتج من السلة؟')) {
          state.cart.splice(index, 1);
          saveAll();
          renderCart();
          playSound('delete');
          showToast('🗑️ حُذف من السلة');
        }
      });
    });
  }

  /* -------------------------
     نظام التقارير المتقدم
     ------------------------- */
  function generateAdvancedReport() {
    const report = {
      period: 'شهري',
      generatedAt: new Date().toISOString(),
      products: {
        total: state.products.length,
        bySection: {},
        topSelling: state.products
          .filter(p => p.sold > 0)
          .sort((a, b) => (b.sold || 0) - (a.sold || 0))
          .slice(0, 5)
      },
      sales: {
        totalOrders: state.orders.length,
        totalRevenue: state.orders.reduce((sum, order) => sum + (order.total || 0), 0),
        averageOrder: state.orders.length > 0 ? 
          state.orders.reduce((sum, order) => sum + (order.total || 0), 0) / state.orders.length : 0
      },
      customers: {
        total: [...new Set(state.orders.map(o => o.customerPhone))].length,
        repeatCustomers: findRepeatCustomers()
      }
    };

    // إحصائيات الأقسام
    state.products.forEach(product => {
      if (!report.products.bySection[product.section]) {
        report.products.bySection[product.section] = 0;
      }
      report.products.bySection[product.section]++;
    });

    return report;
  }

  function findRepeatCustomers() {
    const customerOrders = {};
    state.orders.forEach(order => {
      if (!customerOrders[order.customerPhone]) {
        customerOrders[order.customerPhone] = 0;
      }
      customerOrders[order.customerPhone]++;
    });

    return Object.values(customerOrders).filter(count => count > 1).length;
  }

  function exportReportToPDF() {
    const report = generateAdvancedReport();
    const printWindow = window.open('', '_blank');
    
    printWindow.document.write(`
      <html>
        <head>
          <title>تقرير متجر الواحة فود</title>
          <style>
            body { font-family: Arial, sans-serif; direction: rtl; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .section { margin-bottom: 20px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
            .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            .stat-item { background: #f5f5f5; padding: 10px; border-radius: 5px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>تقرير متجر الواحة فود</h1>
            <p>${new Date(report.generatedAt).toLocaleString('ar-EG')}</p>
          </div>
          
          <div class="section">
            <h2>📊 الإحصائيات العامة</h2>
            <div class="stats-grid">
              <div class="stat-item"><strong>${report.products.total}</strong><br>المنتجات</div>
              <div class="stat-item"><strong>${report.sales.totalOrders}</strong><br>الطلبات</div>
              <div class="stat-item"><strong>${report.sales.totalRevenue.toFixed(2)}</strong><br>إجمالي المبيعات</div>
              <div class="stat-item"><strong>${report.customers.total}</strong><br>العملاء</div>
            </div>
          </div>
          
          <div class="section">
            <h2>🏆 المنتجات الأكثر مبيعاً</h2>
            ${report.products.topSelling.map(product => `
              <p>${product.name} - ${product.sold || 0} مبيعات</p>
            `).join('')}
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
    printWindow.print();
  }

  /* -------------------------
     نظام الخصومات والعروض
     ------------------------- */
  function addDiscount(discount) {
    discount.id = uid('discount');
    discount.createdAt = new Date().toISOString();
    discount.active = true;
    state.discounts.push(discount);
    save(LS_KEYS.discounts, state.discounts);
    showToast('✅ تم إضافة عرض الخصم');
    renderDiscountsList();
  }

  function applyDiscountsToCart() {
    let total = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    let discountAmount = 0;
    let appliedDiscounts = [];

    state.discounts.forEach(discount => {
      if (isDiscountValid(discount)) {
        let discountValue = 0;
        
        if (discount.type === 'percentage') {
          discountValue = total * (discount.value / 100);
        } else if (discount.type === 'fixed') {
          discountValue = discount.value;
        }
        
        if (discountValue > 0) {
          discountAmount += discountValue;
          appliedDiscounts.push({
            name: discount.name,
            value: discountValue
          });
        }
      }
    });

    return {
      originalTotal: total,
      discountAmount,
      finalTotal: Math.max(0, total - discountAmount),
      appliedDiscounts
    };
  }

  function isDiscountValid(discount) {
    const now = new Date();
    const startDate = new Date(discount.startDate || now);
    const endDate = new Date(discount.endDate || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)); // 30 يوم افتراضي
    
    return now >= startDate && now <= endDate && discount.active;
  }

  function renderDiscountsList() {
    const discountsList = document.getElementById('activeDiscountsList');
    if (!discountsList) return;

    if (state.discounts.length === 0) {
      discountsList.innerHTML = '<p style="text-align: center; color: #666;">لا توجد عروض خصم نشطة</p>';
      return;
    }

    discountsList.innerHTML = state.discounts.map(discount => `
      <div style="background: white; padding: 15px; border-radius: var(--radius); margin-bottom: 10px; border: 2px solid #4caf50;">
        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 10px;">
          <strong>${discount.name}</strong>
          <span style="background: #4caf50; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px;">
            ${discount.type === 'percentage' ? discount.value + '%' : discount.value + ' ج.م'}
          </span>
        </div>
        <div style="font-size: 14px; color: #666;">
          ${discount.active ? '🟢 نشط' : '🔴 غير نشط'}
        </div>
      </div>
    `).join('');
  }

  /* -------------------------
     Event listeners setup - النسخة المحسنة
     ------------------------- */
  function setupEventListeners() {
    // إدارة السلة
    if (elements.clearCartBtn) {
      elements.clearCartBtn.addEventListener('click', () => {
        if (state.cart.length === 0) return;
        if (confirm('هل تريد مسح السلة بالكامل؟')) {
          state.cart = [];
          saveAll();
          renderCart();
          showToast('🧹 تم مسح السلة');
        }
      });
    }
    
    if (elements.cartBtn) {
      elements.cartBtn.addEventListener('click', () => {
        if (elements.cartSidebar) {
          elements.cartSidebar.classList.toggle('active');
          renderCart();
        }
      });
    }
    
    if (elements.closeCartBtn) {
      elements.closeCartBtn.addEventListener('click', () => {
        if (elements.cartSidebar) {
          elements.cartSidebar.classList.remove('active');
        }
      });
    }
    
    document.addEventListener('click', (e) => {
      if (!elements.cartSidebar || !elements.cartSidebar.classList.contains('active')) return;
      
      const isClickInsideCart = elements.cartSidebar.contains(e.target);
      const isClickOnCartBtn = elements.cartBtn && elements.cartBtn.contains(e.target);
      
      if (!isClickInsideCart && !isClickOnCartBtn) {
        elements.cartSidebar.classList.remove('active');
      }
    });
    
    // أزرار تحكم المسؤول في الواجهة الرئيسية
    if (elements.addProductMain) {
      elements.addProductMain.addEventListener('click', () => {
        openEditModal(null);
      });
    }

    if (elements.deleteAllProductsMain) {
      elements.deleteAllProductsMain.addEventListener('click', async () => {
        if (state.products.length === 0) return;
        if (confirm('هل تريد حذف كل المنتجات؟')) {
          state.products = [];
          save(LS_KEYS.products, state.products);
          
          if (firebaseInitialized && db) {
            try {
              const batch = db.batch();
              const snapshot = await db.collection('products').get();
              snapshot.forEach(doc => {
                batch.delete(doc.ref);
              });
              await batch.commit();
              showToast('💥 تم مسح جميع المنتجات من السحابة');
            } catch (error) {
              console.error('خطأ في حذف المنتجات من Firebase:', error);
              showToast('💥 تم مسح جميع المنتجات محلياً فقط');
            }
          } else {
            showToast('💥 تم مسح جميع المنتجات محلياً');
          }
          
          renderProducts();
          renderAdminProducts();
        }
      });
    }
    
    // إدارة الطلبات والواتساب
    if (elements.checkoutBtn) {
      elements.checkoutBtn.addEventListener('click', () => {
        if (state.cart.length === 0) {
          showToast('السلة فارغة');
          return;
        }
        
        if (elements.checkoutModal) {
          elements.checkoutModal.classList.add('show');
        }
        
        const total = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        if (elements.checkoutSummary) {
          elements.checkoutSummary.innerHTML = 
            state.cart.map(item => 
              `${item.name} × ${item.qty} — ${(item.price * item.qty).toFixed(2)} ج.م`
            ).join('<br>') + 
            `<hr style="margin:10px 0;"><strong>الإجمالي: ${total.toFixed(2)} ج.م</strong>`;
        }
      });
    }
    
    if (elements.cancelCheckout) {
      elements.cancelCheckout.addEventListener('click', () => {
        if (elements.checkoutModal) {
          elements.checkoutModal.classList.remove('show');
        }
      });
    }
    
    if (elements.confirmCheckout) {
      elements.confirmCheckout.addEventListener('click', async () => {
        const name = elements.checkoutName ? elements.checkoutName.value.trim() : '';
        const phone = elements.checkoutPhone ? elements.checkoutPhone.value.trim() : '';
        
        if (!name) return showToast('أدخل الاسم الكامل');
        if (!phone) return showToast('أدخل رقم الهاتف');
        
        const orderData = {
          id: uid('order'),
          customerName: name,
          customerPhone: phone,
          items: [...state.cart],
          total: state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        
        const firebaseOrderId = await saveOrderToFirebase(orderData);
        
        if (firebaseOrderId) {
          showToast('✅ تم حفظ الطلب في السحابة');
        } else {
          showToast('⚠️ تم حفظ الطلب محلياً فقط');
        }
        
        sendCartToWhatsApp(name, phone);
        
        state.cart = [];
        saveAll();
        renderCart();
        
        if (elements.checkoutModal) {
          elements.checkoutModal.classList.remove('show');
        }
        
        showToast('✅ تم إرسال الطلب بنجاح');
      });
    }
    
    if (elements.cartWhatsappBtn) {
      elements.cartWhatsappBtn.addEventListener('click', () => {
        if (state.cart.length === 0) {
          showToast('السلة فارغة');
          return;
        }
        sendCartToWhatsApp();
      });
    }
    
    // إعدادات الإدارة
    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener('click', () => {
        if (elements.passwordModal) {
          elements.passwordModal.classList.add('show');
          if (elements.adminPassword) {
            elements.adminPassword.value = '';
            setTimeout(() => {
              elements.adminPassword.focus();
            }, 100);
          }
        }
      });
    }
    
    if (elements.passwordCancel) {
      elements.passwordCancel.addEventListener('click', () => {
        if (elements.passwordModal) {
          elements.passwordModal.classList.remove('show');
        }
      });
    }
    
    if (elements.passwordSubmit) {
      elements.passwordSubmit.addEventListener('click', () => {
        const password = elements.adminPassword ? elements.adminPassword.value.trim() : '';
        if (password === ADMIN_PASS) {
          if (elements.passwordModal) elements.passwordModal.classList.remove('show');
          if (elements.settingsModal) {
            elements.settingsModal.classList.add('show');
            initSettingsUI();
          }
          showToast('مرحباً بك يا مسؤول! 👑');
        } else {
          showToast('كلمة المرور غير صحيحة');
        }
      });
    }
    
    if (elements.adminPassword) {
      elements.adminPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          elements.passwordSubmit.click();
        }
      });
    }
    
    if (elements.closeSettings) {
      elements.closeSettings.addEventListener('click', () => {
        if (elements.settingsModal) {
          elements.settingsModal.classList.remove('show');
        }
      });
    }
    
    // زر تبديل وضع المسؤول
    if (elements.toggleAdminView) {
      elements.toggleAdminView.addEventListener('click', toggleAdminMode);
    }
    
    // الألسنة في الإعدادات
    qa('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        qa('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        qa('.tab-content').forEach(c => c.classList.add('hidden'));
        const targetContent = $(`tab-${tabName}`);
        if (targetContent) targetContent.classList.remove('hidden');
        
        if (tabName === 'products') renderAdminProducts();
        if (tabName === 'sections') renderAdminSections();
        if (tabName === 'colors') {
          updateLogoPreview();
          renderCustomIcons();
        }
        if (tabName === 'store') {
          renderOrdersList();
          updateStatisticsUI();
        }
        if (tabName === 'database') {
          loadFirebaseConfig();
          updateOfflineQueueUI();
        }
        if (tabName === 'reports') {
          renderDiscountsList();
        }
      });
    });
    
    // إضافة قسم جديد
    if (elements.addSectionBtn && elements.newSectionName && elements.newSectionIcon) {
      elements.addSectionBtn.addEventListener('click', async () => {
        const sectionName = elements.newSectionName.value.trim();
        const sectionIcon = elements.newSectionIcon.value.trim() || '❓';
        
        if (!sectionName) {
          showToast('اكتب اسم القسم');
          return;
        }
        
        const newSection = {
          name: sectionName,
          icon: sectionIcon
        };
        
        await saveSection(newSection, true);
        
        elements.newSectionName.value = '';
        elements.newSectionIcon.value = '';
        
        renderSections();
        renderAdminSections();
        showToast('✅ تم إضافة قسم');
      });
    }
    
    // فتح مكتبة الأيقونات
    if (elements.openIconsModal) {
      elements.openIconsModal.addEventListener('click', () => {
        const currentIcon = elements.newSectionIcon ? elements.newSectionIcon.value : '';
        openIconsModal(currentIcon);
      });
    }
    
    if (elements.closeIconsModal) {
      elements.closeIconsModal.addEventListener('click', closeIconsModal);
    }
    
    document.addEventListener('click', (e) => {
      const iconsModal = $('iconsModal');
      if (iconsModal && iconsModal.classList.contains('show')) {
        if (!iconsModal.contains(e.target) && e.target.id !== 'openIconsModal') {
          closeIconsModal();
        }
      }
    });
    
    // إضافة منتج جديد من الإدارة
    if (elements.addProductBtn) {
      elements.addProductBtn.addEventListener('click', () => {
        openEditModal(null);
      });
    }
    
    // حذف جميع المنتجات
    if (elements.deleteAllProductsBtn) {
      elements.deleteAllProductsBtn.addEventListener('click', async () => {
        if (state.products.length === 0) return;
        if (confirm('هل تريد حذف كل المنتجات؟')) {
          state.products = [];
          save(LS_KEYS.products, state.products);
          
          if (firebaseInitialized && db) {
            try {
              const batch = db.batch();
              const snapshot = await db.collection('products').get();
              snapshot.forEach(doc => {
                batch.delete(doc.ref);
              });
              await batch.commit();
              showToast('💥 تم مسح جميع المنتجات من السحابة');
            } catch (error) {
              console.error('خطأ في حذف المنتجات من Firebase:', error);
              showToast('💥 تم مسح جميع المنتجات محلياً فقط');
            }
          } else {
            showToast('💥 تم مسح جميع المنتجات محلياً');
          }
          
          renderProducts();
          renderAdminProducts();
        }
      });
    }
    
    // إعدادات الألوان
    if (elements.applyTheme) {
      elements.applyTheme.addEventListener('click', () => {
        state.theme.main = elements.mainColor ? elements.mainColor.value : state.theme.main;
        state.theme.bg = elements.bgColor ? elements.bgColor.value : state.theme.bg;
        state.theme.text = elements.textColor ? elements.textColor.value : state.theme.text;
        applyThemeToUI();
        saveAll();
        showToast('🎨 تم تطبيق الألوان');
      });
    }
    
    if (elements.resetTheme) {
      elements.resetTheme.addEventListener('click', () => {
        state.theme = { main: '#ffb300', bg: '#fafafa', text: '#222' };
        applyThemeToUI();
        saveAll();
        showToast('♻️ استعادة الافتراضي');
      });
    }
    
    // إدارة اللوجو
    if (elements.uploadLogoBtn && elements.logoUpload) {
      elements.uploadLogoBtn.addEventListener('click', () => {
        const file = elements.logoUpload.files[0];
        if (!file) {
          showToast('اختر صورة أولاً');
          return;
        }
        
        if (!file.type.startsWith('image/')) {
          showToast('الرجاء اختيار ملف صورة');
          return;
        }
        
        if (file.size > 2 * 1024 * 1024) {
          showToast('حجم الصورة كبير جداً (الحد الأقصى 2MB)');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
          changeLogo(e.target.result);
          elements.logoUpload.value = '';
        };
        reader.readAsDataURL(file);
      });
    }
    
    if (elements.applyLogoUrl && elements.logoUrl) {
      elements.applyLogoUrl.addEventListener('click', () => {
        const url = elements.logoUrl.value.trim();
        if (!url) {
          showToast('أدخل رابط الصورة');
          return;
        }
        
        if (!url.startsWith('http')) {
          showToast('أدخل رابط صحيح يبدأ بـ http أو https');
          return;
        }
        
        changeLogo(url);
        elements.logoUrl.value = '';
      });
      
      elements.logoUrl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          elements.applyLogoUrl.click();
        }
      });
    }
    
    if (elements.resetLogo) {
      elements.resetLogo.addEventListener('click', resetLogo);
    }
    
    // رفع الأيقونات من الإعدادات
    if (elements.uploadIconBtn && elements.iconUpload) {
      elements.uploadIconBtn.addEventListener('click', () => {
        const file = elements.iconUpload.files[0];
        uploadCustomIcon(file, 'settings');
        elements.iconUpload.value = '';
      });
    }

    // رفع الأيقونات من النافذة المنبثقة
    if (elements.uploadIconModalBtn && elements.iconUploadModal) {
      elements.uploadIconModalBtn.addEventListener('click', () => {
        const file = elements.iconUploadModal.files[0];
        uploadCustomIcon(file, 'modal');
        elements.iconUploadModal.value = '';
      });
    }
    
    // تغيير كلمة المرور
    if (elements.changePasswordBtn) {
      elements.changePasswordBtn.addEventListener('click', () => {
        const currentPass = elements.currentPassword ? elements.currentPassword.value.trim() : '';
        const newPass = elements.newPassword ? elements.newPassword.value.trim() : '';
        const confirmPass = elements.confirmPassword ? elements.confirmPassword.value.trim() : '';
        
        const error = changeAdminPassword(currentPass, newPass, confirmPass);
        
        if (error) {
          showToast(error);
        } else {
          showToast('✅ تم تغيير كلمة المرور بنجاح');
          if (elements.currentPassword) elements.currentPassword.value = '';
          if (elements.newPassword) elements.newPassword.value = '';
          if (elements.confirmPassword) elements.confirmPassword.value = '';
        }
      });
    }
    
    // إعدادات قاعدة البيانات
    if (elements.saveFirebaseConfig) {
      elements.saveFirebaseConfig.addEventListener('click', () => {
        const apiKey = elements.firebaseApiKey ? elements.firebaseApiKey.value.trim() : '';
        const projectId = elements.firebaseProjectId ? elements.firebaseProjectId.value.trim() : '';
        const authDomain = elements.firebaseAuthDomain ? elements.firebaseAuthDomain.value.trim() : '';
        
        if (!apiKey || !projectId) {
          showToast('❌ أدخل API Key و Project ID');
          return;
        }
        
        state.firebaseConfig = {
          apiKey,
          projectId,
          authDomain: authDomain || `${projectId}.firebaseapp.com`
        };
        
        save(LS_KEYS.firebaseConfig, state.firebaseConfig);
        showToast('✅ تم حفظ إعدادات Firebase');
      });
    }
    
    if (elements.testFirebaseConnection) {
      elements.testFirebaseConnection.addEventListener('click', () => {
        if (!state.firebaseConfig.apiKey || !state.firebaseConfig.projectId) {
          showToast('❌ أدخل إعدادات Firebase أولاً');
          return;
        }
        
        showToast('🔗 جاري اختبار الاتصال...');
        const success = initializeFirebase(state.firebaseConfig);
        
        if (success) {
          showToast('✅ تم الاتصال بنجاح');
        } else {
          showToast('❌ فشل الاتصال');
        }
      });
    }
    
    if (elements.syncToCloud) {
      elements.syncToCloud.addEventListener('click', async () => {
        if (!firebaseInitialized) {
          showToast('❌ Firebase غير مهيأ');
          return;
        }
        
        showToast('☁️ جاري مزامنة جميع البيانات...');
        await syncAllToFirebase();
      });
    }
    
    if (elements.syncFromCloud) {
      elements.syncFromCloud.addEventListener('click', async () => {
        if (!firebaseInitialized) {
          showToast('❌ Firebase غير مهيأ');
          return;
        }
        
        showToast('📥 جاري جلب البيانات من السحابة...');
        await syncAllFromFirebase();
      });
    }
    
    if (elements.clearLocalData) {
      elements.clearLocalData.addEventListener('click', () => {
        if (confirm('هل تريد مسح جميع البيانات المحلية؟ هذا الإجراء لا يمكن التراجع عنه.')) {
          localStorage.clear();
          showToast('🗑️ تم مسح جميع البيانات المحلية');
          setTimeout(() => {
            location.reload();
          }, 2000);
        }
      });
    }
    
    // النسخ الاحتياطي
    if (elements.createBackup) {
      elements.createBackup.addEventListener('click', createDownloadableBackup);
    }

    if (elements.autoBackupToggle) {
      elements.autoBackupToggle.addEventListener('click', () => {
        startAutoBackup();
        showToast('✅ تم تفعيل النسخ الاحتياطي التلقائي');
      });
    }

    if (elements.restoreBackup && elements.backupFile) {
      elements.restoreBackup.addEventListener('click', () => {
        const file = elements.backupFile.files[0];
        restoreFromBackup(file);
        elements.backupFile.value = '';
      });
    }
    
    // إعدادات المتجر
    if (elements.saveStoreSettings) {
      elements.saveStoreSettings.addEventListener('click', () => {
        const storeSettings = {
          storeName: elements.storeName?.value || 'الواحة فود',
          whatsappNumber: elements.whatsappNumber?.value || '201095985529',
          storeDescription: elements.storeDescription?.value || '',
          storeAddress: elements.storeAddress?.value || ''
        };
        
        saveStoreSettings(storeSettings);
        applyStoreSettings(storeSettings);
        showToast('✅ تم حفظ إعدادات المتجر');
      });
    }

    // إعدادات الواجهة
    if (elements.applyUISettings) {
      elements.applyUISettings.addEventListener('click', () => {
        const uiSettings = {
          productsPerRow: elements.productsPerRow?.value || '4',
          fontSize: elements.fontSize?.value || 'medium',
          fontFamily: elements.fontFamily?.value || 'Cairo, sans-serif',
          showAnimations: elements.showAnimations?.checked || false,
          showTopSellers: elements.showTopSellers?.checked || false,
          autoOpenCart: elements.autoOpenCart?.checked || false
        };
        
        saveStoreSettings(uiSettings);
        applyStoreSettings(uiSettings);
        showToast('✅ تم تطبيق إعدادات الواجهة');
      });
    }

    // إدارة الطلبات
    if (elements.refreshOrders) {
      elements.refreshOrders.addEventListener('click', renderOrdersList);
    }

    if (elements.exportOrders) {
      elements.exportOrders.addEventListener('click', exportOrders);
    }

    // الإحصائيات
    if (elements.generateReport) {
      elements.generateReport.addEventListener('click', () => {
        updateStatisticsUI();
        showToast('📊 تم تحديث الإحصائيات');
      });
    }

    // إعدادات الأمان
    if (elements.saveSecuritySettings) {
      elements.saveSecuritySettings.addEventListener('click', () => {
        const securitySettings = {
          requireLogin: elements.requireLogin?.checked || false,
          autoLogout: elements.autoLogout?.checked || false,
          backupToCloud: elements.backupToCloud?.checked || false,
          safeDeleteLimit: elements.safeDeleteLimit?.value || '2'
        };
        
        saveStoreSettings(securitySettings);
        showToast('✅ تم حفظ إعدادات الأمان');
      });
    }
    
    // المهام المؤجلة
    if (elements.processQueueNow) {
      elements.processQueueNow.addEventListener('click', processQueueManually);
    }

    if (elements.clearQueue) {
      elements.clearQueue.addEventListener('click', clearOfflineQueue);
    }
    
    // التقارير
    if (elements.generateMonthlyReport) {
      elements.generateMonthlyReport.addEventListener('click', () => {
        const report = generateAdvancedReport();
        showToast('📅 تم إنشاء التقرير الشهري');
        console.log('التقرير الشهري:', report);
      });
    }

    if (elements.exportPDF) {
      elements.exportPDF.addEventListener('click', exportReportToPDF);
    }

    // الخصومات
    if (elements.addDiscountBtn) {
      elements.addDiscountBtn.addEventListener('click', () => {
        const name = elements.discountName?.value.trim() || '';
        const type = elements.discountType?.value || 'percentage';
        const value = parseFloat(elements.discountValue?.value || 0);
        
        if (!name) {
          showToast('أدخل اسم العرض');
          return;
        }
        
        if (value <= 0) {
          showToast('أدخل قيمة صحيحة للخصم');
          return;
        }
        
        const discount = {
          name,
          type,
          value,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 يوم من الآن
        };
        
        addDiscount(discount);
        
        // مسح الحقول
        if (elements.discountName) elements.discountName.value = '';
        if (elements.discountValue) elements.discountValue.value = '';
      });
    }
    
    // عناصر التحكم في الرأس
    if (elements.zoomIn) {
      elements.zoomIn.addEventListener('click', () => {
        state.zoom = Math.min(1.4, +(state.zoom + 0.1).toFixed(2));
        applyZoom();
      });
    }
    
    if (elements.zoomOut) {
      elements.zoomOut.addEventListener('click', () => {
        state.zoom = Math.max(0.8, +(state.zoom - 0.1).toFixed(2));
        applyZoom();
      });
    }
    
    if (elements.themeToggle) {
      elements.themeToggle.addEventListener('click', () => {
        state.darkMode = !state.darkMode;
        applyDark();
        saveAll();
        showToast(state.darkMode ? '🌙 وضع ليلي' : '🌤 وضع نهاري');
      });
    }
    
    // البحث
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.trim();
        const activeSection = elements.sectionList ? elements.sectionList.querySelector('.section-btn.active') : null;
        const sectionFilter = activeSection ? activeSection.dataset.section : null;
        
        renderProducts(
          sectionFilter && sectionFilter !== 'ALL' ? sectionFilter : null,
          searchTerm
        );
      });
    }
    
    // إيقاف المترو عند التمرير
    if (elements.bannerTrack) {
      elements.bannerTrack.addEventListener('mouseenter', () => {
        elements.bannerTrack.style.animationPlayState = 'paused';
      });
      
      elements.bannerTrack.addEventListener('mouseleave', () => {
        elements.bannerTrack.style.animationPlayState = 'running';
      });
    }
  }

  /* -------------------------
     WhatsApp integration
     ------------------------- */
  function sendCartToWhatsApp(name = '', phone = '') {
    if (state.cart.length === 0) {
      showToast('السلة فارغة');
      return;
    }
    
    const storeSettings = loadStoreSettings();
    let total = 0;
    let message = `مرحبًا، أود طلب المنتجات التالية من ${storeSettings.storeName}:\n\n`;
    
    state.cart.forEach(item => {
      const itemTotal = item.price * item.qty;
      total += itemTotal;
      message += `🛒 ${item.name}\n`;
      message += `   الكمية: ${item.qty}\n`;
      message += `   السعر: ${item.price.toFixed(2)} ج.م\n`;
      message += `   الإجمالي: ${itemTotal.toFixed(2)} ج.م\n\n`;
    });
    
    message += `💰 الإجمالي الكلي: ${total.toFixed(2)} ج.م\n`;
    
    if (name && phone) {
      message += `\n👤 معلومات العميل:\n`;
      message += `   الاسم: ${name}\n`;
      message += `   الهاتف: ${phone}\n`;
    }
    
    message += `\nشكراً لكم ❤️`;
    
    const whatsappNumber = storeSettings.whatsappNumber;
    const encodedMessage = encodeURIComponent(message);
    const whatsappURL = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`;
    
    window.open(whatsappURL, '_blank');
  }

  /* -------------------------
     Settings UI initialization
     ------------------------- */
  function loadFirebaseConfig() {
    if (elements.firebaseApiKey) elements.firebaseApiKey.value = state.firebaseConfig.apiKey || '';
    if (elements.firebaseProjectId) elements.firebaseProjectId.value = state.firebaseConfig.projectId || '';
    if (elements.firebaseAuthDomain) elements.firebaseAuthDomain.value = state.firebaseConfig.authDomain || '';
    
    if (firebaseInitialized) {
      updateSyncStatus('✅ متصل بقاعدة البيانات', '#28a745');
    } else if (state.firebaseConfig.apiKey) {
      updateSyncStatus('⚠️ إعدادات محفوظة - جاري الاتصال...', '#ffc107');
    } else {
      updateSyncStatus('❌ غير متصل - أدخل إعدادات Firebase', '#dc3545');
    }
  }

  function initSettingsUI() {
    const firstTab = qa('.tab')[0];
    if (firstTab) {
      qa('.tab').forEach(t => t.classList.remove('active'));
      firstTab.classList.add('active');
      
      qa('.tab-content').forEach(c => c.classList.add('hidden'));
      const firstContent = $(`tab-${firstTab.dataset.tab}`);
      if (firstContent) firstContent.classList.remove('hidden');
    }
    
    updateLogoPreview();
    renderAdminProducts();
    renderAdminSections();
    fillSectionSelects();
    renderCustomIcons();
    loadFirebaseConfig();
    renderOrdersList();
    updateStatisticsUI();
    updateOfflineQueueUI();
    renderDiscountsList();
    
    // تحميل إعدادات المتجر وعرضها
    const storeSettings = loadStoreSettings();
    updateStoreSettingsUI(storeSettings);
  }

  /* -------------------------
     Initialization - النسخة المحسنة
     ------------------------- */
  function init() {
    // تحميل وإعدادات المتجر
    const storeSettings = loadStoreSettings();
    applyStoreSettings(storeSettings);
    
    applyThemeToUI();
    applyDark();
    applyZoom();
    updateLogoPreview();
    renderSections();
    renderProducts();
    renderAdminProducts();
    renderAdminSections();
    renderCart();
    updateMetro();
    setupEventListeners();
    
    // إعداد نظام العمل بدون إنترنت
    setupAutoSync();
    updateOnlineStatus();
    createConnectionStatusIndicator();
    updateOfflineQueueUI();
    
    // مراقبة تغييرات حالة الاتصال
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    
    // تحديث واجهة المهام المؤجلة كل 10 ثواني
    setInterval(updateOfflineQueueUI, 10000);
    
    // تفعيل النسخ الاحتياطي التلقائي
    startAutoBackup();
    
    // محاولة تهيئة Firebase تلقائياً إذا كانت الإعدادات موجودة
    if (state.firebaseConfig.apiKey) {
      setTimeout(() => {
        initializeFirebase(state.firebaseConfig);
      }, 1000);
    }
    
    showToast('مرحبًا بك في متجر الواحة فود! 🛍️', 2000, 'success');
  }

  // بدء التطبيق
  init();

  window.waha_v3 = {
    state,
    elements,
    functions: {
      renderProducts,
      renderSections,
      saveAll,
      addToCart,
      toggleAdminMode,
      initializeFirebase,
      syncAllToFirebase,
      syncAllFromFirebase,
      saveProduct,
      deleteProduct,
      loadStoreSettings,
      applyStoreSettings,
      processOfflineQueue,
      updateOnlineStatus
    }
  };

})();