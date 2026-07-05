-- ============================================
-- نظام إدارة الاشتراكات - قاعدة البيانات
-- ============================================

-- جدول المستخدمين
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول الاشتراكات (التراخيص)
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    license_key VARCHAR(50) UNIQUE NOT NULL,
    package_name VARCHAR(100) NOT NULL,      -- basic, premium, pro
    max_devices INTEGER DEFAULT 1,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',    -- active, expired, cancelled, suspended
    auto_renew BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول الأجهزة المرتبطة بالاشتراكات
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    device_id VARCHAR(255) UNIQUE NOT NULL,
    device_name VARCHAR(255),
    android_version VARCHAR(50),
    app_version VARCHAR(50),
    ip VARCHAR(45),
    last_seen TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول سجلات الدفع (اختياري)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method VARCHAR(50),
    transaction_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول السجلات
CREATE TABLE logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- فهارس للسرعة
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_license_key ON subscriptions(license_key);
CREATE INDEX idx_subscriptions_end_date ON subscriptions(end_date);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_devices_subscription_id ON devices(subscription_id);
CREATE INDEX idx_devices_device_id ON devices(device_id);
CREATE INDEX idx_devices_last_seen ON devices(last_seen);

-- إضافة المستخدم الأول (المطور)
INSERT INTO users (id, name, email, password, role) 
VALUES (
    gen_random_uuid(),
    'المطور الرئيسي',
    'admin@smartapp.com',
    '$2a$10$YourHashedPasswordHere',  -- استخدم bcrypt لتشفير كلمة المرور
    'admin'
);

-- إضافة اشتراك تجريبي للمطور
INSERT INTO subscriptions (
    user_id,
    license_key,
    package_name,
    max_devices,
    start_date,
    end_date,
    status
)
SELECT 
    id,
    'DEMO-2026-0001',
    'premium',
    5,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP + INTERVAL '365 days',
    'active'
FROM users 
WHERE email = 'admin@smartapp.com';
