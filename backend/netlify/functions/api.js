// ============================================
// نظام إدارة الاشتراكات - API
// ============================================

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ============================================
// الإعدادات
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// الأدوات المساعدة
// ============================================

// إنشاء مفتاح ترخيص فريد
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) key += '-';
    }
    return key;
}

// التحقق من JWT
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// التحقق من المصادقة
async function authMiddleware(event) {
    const authHeader = event.headers.authorization;
    if (!authHeader) return { error: 'Unauthorized', status: 401 };
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = verifyToken(token);
    if (!decoded) return { error: 'Invalid token', status: 401 };
    
    // التحقق من الجلسة في قاعدة البيانات
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.userId)
        .single();
        
    if (error || !data) return { error: 'User not found', status: 401 };
    
    return { user: data };
}

// تسجيل الأحداث
async function logEvent(type, message, userId = null, severity = 'info') {
    await supabase.from('logs').insert({
        user_id: userId,
        type: type,
        message: message,
        severity: severity
    });
}

// ============================================
// نقاط النهاية API
// ============================================

const handlers = {

    // ============================================
    // POST /login - تسجيل الدخول
    // ============================================
    async login(event) {
        const { email, password } = JSON.parse(event.body);
        
        if (!email || !password) {
            return { error: 'Email and password required', status: 400 };
        }
        
        // البحث عن المستخدم
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
            
        if (error || !user) {
            await logEvent('login_failed', `فشل تسجيل الدخول للبريد: ${email}`);
            return { error: 'Invalid credentials', status: 401 };
        }
        
        // التحقق من كلمة المرور
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            await logEvent('login_failed', `كلمة مرور خاطئة للبريد: ${email}`);
            return { error: 'Invalid credentials', status: 401 };
        }
        
        // إنشاء JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        await logEvent('login_success', `تسجيل دخول ناجح: ${email}`, user.id);
        
        return {
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        };
    },

    // ============================================
    // POST /subscriptions/create - إنشاء اشتراك
    // ============================================
    async createSubscription(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { userId, packageName, maxDevices, duration, autoRenew } = JSON.parse(event.body);
        
        if (!userId || !packageName) {
            return { error: 'User ID and package name required', status: 400 };
        }
        
        // إنشاء مفتاح ترخيص
        const licenseKey = generateLicenseKey();
        
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + (duration || 30));
        
        const { data, error } = await supabase
            .from('subscriptions')
            .insert({
                user_id: userId,
                license_key: licenseKey,
                package_name: packageName,
                max_devices: maxDevices || 1,
                start_date: startDate,
                end_date: endDate,
                auto_renew: autoRenew || false,
                status: 'active'
            })
            .select()
            .single();
            
        if (error) {
            await logEvent('subscription_error', `فشل إنشاء اشتراك: ${error.message}`, userId, 'error');
            return { error: 'Failed to create subscription', status: 500 };
        }
        
        await logEvent('subscription_created', `تم إنشاء اشتراك: ${licenseKey}`, userId);
        
        return { subscription: data };
    },

    // ============================================
    // POST /subscriptions/verify - التحقق من الاشتراك
    // ============================================
    async verifySubscription(event) {
        const { licenseKey, deviceId, deviceName, androidVersion, appVersion } = JSON.parse(event.body);
        
        if (!licenseKey || !deviceId) {
            return { error: 'License key and device ID required', status: 400 };
        }
        
        // البحث عن الاشتراك
        const { data: subscription, error } = await supabase
            .from('subscriptions')
            .select('*, users(name, email)')
            .eq('license_key', licenseKey)
            .single();
            
        if (error || !subscription) {
            await logEvent('subscription_invalid', `مفتاح غير صالح: ${licenseKey}`);
            return { error: 'Invalid license key', status: 404 };
        }
        
        // التحقق من الحالة
        if (subscription.status !== 'active') {
            await logEvent('subscription_inactive', `اشتراك غير نشط: ${licenseKey}`);
            return { error: 'Subscription is not active', status: 403 };
        }
        
        // التحقق من انتهاء الصلاحية
        if (new Date(subscription.end_date) < new Date()) {
            await logEvent('subscription_expired', `اشتراك منتهي: ${licenseKey}`);
            return { error: 'Subscription expired', status: 403 };
        }
        
        // التحقق من عدد الأجهزة
        const { count } = await supabase
            .from('devices')
            .select('*', { count: 'exact', head: true })
            .eq('subscription_id', subscription.id);
            
        if (count >= subscription.max_devices) {
            // التحقق إذا كان الجهاز مسجلاً بالفعل
            const { data: existingDevice } = await supabase
                .from('devices')
                .select('*')
                .eq('device_id', deviceId)
                .single();
                
            if (!existingDevice) {
                await logEvent('subscription_limit', `تم الوصول للحد الأقصى للأجهزة: ${licenseKey}`);
                return { error: 'Device limit reached', status: 403 };
            }
        }
        
        // تسجيل أو تحديث الجهاز
        const { data: device, error: deviceError } = await supabase
            .from('devices')
            .upsert({
                device_id: deviceId,
                subscription_id: subscription.id,
                device_name: deviceName || 'Unknown Device',
                android_version: androidVersion || 'Unknown',
                app_version: appVersion || '1.0',
                last_seen: new Date(),
                status: 'active'
            }, { onConflict: 'device_id' })
            .select()
            .single();
            
        if (deviceError) {
            await logEvent('device_error', `فشل تسجيل الجهاز: ${deviceError.message}`);
            return { error: 'Failed to register device', status: 500 };
        }
        
        await logEvent('subscription_verified', `تم التحقق من الاشتراك: ${licenseKey}`, subscription.user_id);
        
        return {
            valid: true,
            subscription: {
                id: subscription.id,
                license_key: subscription.license_key,
                package_name: subscription.package_name,
                max_devices: subscription.max_devices,
                end_date: subscription.end_date,
                user: subscription.users
            },
            device: device
        };
    },

    // ============================================
    // GET /subscriptions - الحصول على جميع الاشتراكات
    // ============================================
    async getSubscriptions(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('subscriptions')
            .select('*, users(name, email)')
            .order('created_at', { ascending: false });
            
        if (error) {
            return { error: 'Failed to fetch subscriptions', status: 500 };
        }
        
        // حساب عدد الأجهزة لكل اشتراك
        const subscriptionsWithDevices = await Promise.all(data.map(async (sub) => {
            const { count } = await supabase
                .from('devices')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_id', sub.id);
                
            return {
                ...sub,
                devices_count: count || 0
            };
        }));
        
        return subscriptionsWithDevices;
    },

    // ============================================
    // GET /subscriptions/:id - الحصول على اشتراك محدد
    // ============================================
    async getSubscription(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const id = event.path.split('/').pop();
        
        const { data, error } = await supabase
            .from('subscriptions')
            .select('*, users(name, email), devices(*)')
            .eq('id', id)
            .single();
            
        if (error || !data) {
            return { error: 'Subscription not found', status: 404 };
        }
        
        return data;
    },

    // ============================================
    // PUT /subscriptions/:id - تحديث اشتراك
    // ============================================
    async updateSubscription(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const id = event.path.split('/').pop();
        const { maxDevices, packageName, status, autoRenew } = JSON.parse(event.body);
        
        const updates = {};
        if (maxDevices) updates.max_devices = maxDevices;
        if (packageName) updates.package_name = packageName;
        if (status) updates.status = status;
        if (autoRenew !== undefined) updates.auto_renew = autoRenew;
        updates.updated_at = new Date();
        
        const { data, error } = await supabase
            .from('subscriptions')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to update subscription', status: 500 };
        }
        
        await logEvent('subscription_updated', `تم تحديث الاشتراك: ${data.license_key}`, auth.user.id);
        
        return { subscription: data };
    },

    // ============================================
    // DELETE /subscriptions/:id - حذف اشتراك
    // ============================================
    async deleteSubscription(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const id = event.path.split('/').pop();
        
        // حذف الأجهزة المرتبطة أولاً
        await supabase.from('devices').delete().eq('subscription_id', id);
        
        const { error } = await supabase
            .from('subscriptions')
            .delete()
            .eq('id', id);
            
        if (error) {
            return { error: 'Failed to delete subscription', status: 500 };
        }
        
        await logEvent('subscription_deleted', `تم حذف الاشتراك: ${id}`, auth.user.id);
        
        return { success: true };
    },

    // ============================================
    // POST /subscriptions/renew - تجديد اشتراك
    // ============================================
    async renewSubscription(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { subscriptionId, duration } = JSON.parse(event.body);
        
        if (!subscriptionId) {
            return { error: 'Subscription ID required', status: 400 };
        }
        
        // الحصول على الاشتراك الحالي
        const { data: subscription, error: fetchError } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('id', subscriptionId)
            .single();
            
        if (fetchError || !subscription) {
            return { error: 'Subscription not found', status: 404 };
        }
        
        // تجديد التاريخ
        const newEndDate = new Date(subscription.end_date);
        newEndDate.setDate(newEndDate.getDate() + (duration || 30));
        
        const { data, error } = await supabase
            .from('subscriptions')
            .update({
                end_date: newEndDate,
                status: 'active',
                updated_at: new Date()
            })
            .eq('id', subscriptionId)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to renew subscription', status: 500 };
        }
        
        await logEvent('subscription_renewed', `تم تجديد الاشتراك: ${subscription.license_key}`, auth.user.id);
        
        return { subscription: data };
    },

    // ============================================
    // GET /devices - الحصول على جميع الأجهزة
    // ============================================
    async getDevices(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { data, error } = await supabase
            .from('devices')
            .select('*, subscriptions(license_key, package_name, users(name))')
            .order('last_seen', { ascending: false });
            
        if (error) {
            return { error: 'Failed to fetch devices', status: 500 };
        }
        
        return data;
    },

    // ============================================
    // POST /devices/block - حظر جهاز
    // ============================================
    async blockDevice(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { deviceId } = JSON.parse(event.body);
        
        if (!deviceId) {
            return { error: 'Device ID required', status: 400 };
        }
        
        const { data, error } = await supabase
            .from('devices')
            .update({ status: 'blocked' })
            .eq('id', deviceId)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to block device', status: 500 };
        }
        
        await logEvent('device_blocked', `تم حظر الجهاز: ${data.device_id}`, auth.user.id);
        
        return { success: true, device: data };
    },

    // ============================================
    // POST /devices/unblock - إلغاء حظر جهاز
    // ============================================
    async unblockDevice(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const { deviceId } = JSON.parse(event.body);
        
        if (!deviceId) {
            return { error: 'Device ID required', status: 400 };
        }
        
        const { data, error } = await supabase
            .from('devices')
            .update({ status: 'active' })
            .eq('id', deviceId)
            .select()
            .single();
            
        if (error) {
            return { error: 'Failed to unblock device', status: 500 };
        }
        
        await logEvent('device_unblocked', `تم إلغاء حظر الجهاز: ${data.device_id}`, auth.user.id);
        
        return { success: true, device: data };
    },

    // ============================================
    // GET /stats - إحصائيات سريعة
    // ============================================
    async getStats(event) {
        const auth = await authMiddleware(event);
        if (auth.error) return auth;
        
        const [
            totalUsers,
            totalSubscriptions,
            activeSubscriptions,
            totalDevices,
            activeDevices
        ] = await Promise.all([
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('subscriptions').select('*', { count: 'exact', head: true }),
            supabase.from('subscriptions').select('*', { count: 'exact', head: true })
                .eq('status', 'active')
                .gte('end_date', new Date().toISOString()),
            supabase.from('devices').select('*', { count: 'exact', head: true }),
            supabase.from('devices').select('*', { count: 'exact', head: true })
                .eq('status', 'active')
        ]);
        
        // الاشتراكات المنتهية قريباً (7 أيام)
        const expiringSoon = await supabase
            .from('subscriptions')
            .select('*')
            .eq('status', 'active')
            .lt('end_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
            .gte('end_date', new Date().toISOString());
        
        return {
            users: totalUsers.count || 0,
            subscriptions: totalSubscriptions.count || 0,
            activeSubscriptions: activeSubscriptions.count || 0,
            devices: totalDevices.count || 0,
            activeDevices: activeDevices.count || 0,
            expiringSoon: expiringSoon.data?.length || 0
        };
    }
};

// ============================================
// Router
// ============================================
exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    const path = event.path.replace('/.netlify/functions/api', '');
    const method = event.httpMethod;
    
    try {
        let result;
        
        // Routing
        switch (true) {
            // المصادقة
            case path === '/login' && method === 'POST':
                result = await handlers.login(event);
                break;
                
            // الاشتراكات
            case path === '/subscriptions' && method === 'GET':
                result = await handlers.getSubscriptions(event);
                break;
            case path === '/subscriptions/create' && method === 'POST':
                result = await handlers.createSubscription(event);
                break;
            case path === '/subscriptions/verify' && method === 'POST':
                result = await handlers.verifySubscription(event);
                break;
            case path === '/subscriptions/renew' && method === 'POST':
                result = await handlers.renewSubscription(event);
                break;
            case path.match(/^\/subscriptions\/[^\/]+$/) && method === 'GET':
                result = await handlers.getSubscription(event);
                break;
            case path.match(/^\/subscriptions\/[^\/]+$/) && method === 'PUT':
                result = await handlers.updateSubscription(event);
                break;
            case path.match(/^\/subscriptions\/[^\/]+$/) && method === 'DELETE':
                result = await handlers.deleteSubscription(event);
                break;
                
            // الأجهزة
            case path === '/devices' && method === 'GET':
                result = await handlers.getDevices(event);
                break;
            case path === '/devices/block' && method === 'POST':
                result = await handlers.blockDevice(event);
                break;
            case path === '/devices/unblock' && method === 'POST':
                result = await handlers.unblockDevice(event);
                break;
                
            // الإحصائيات
            case path === '/stats' && method === 'GET':
                result = await handlers.getStats(event);
                break;
                
            default:
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Not found' })
                };
        }
        
        // التحقق من وجود خطأ
        if (result && result.error) {
            return {
                statusCode: result.status || 400,
                headers,
                body: JSON.stringify({ error: result.error })
            };
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
        };
        
    } catch (error) {
        console.error('API Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
