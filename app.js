// ============================================
// نظام إدارة الاشتراكات - لوحة التحكم
// ============================================

class SubscriptionManager {
    constructor() {
        this.currentPage = 'dashboard';
        this.token = localStorage.getItem('auth_token');
        this.user = null;
        this.init();
    }

    async init() {
        this.loadTheme();
        this.setupEventListeners();
        await this.loadUser();
        await this.navigateTo('dashboard');
    }

    loadTheme() {
        const saved = localStorage.getItem('theme') || 'dark';
        document.documentElement.className = saved === 'dark' ? '' : 'light-theme';
        document.getElementById('themeToggle').innerHTML = 
            `<i class="fas fa-${saved === 'dark' ? 'moon' : 'sun'}"></i>`;
    }

    setupEventListeners() {
        document.getElementById('themeToggle').addEventListener('click', () => {
            const newTheme = document.documentElement.className === 'light-theme' ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme);
            this.loadTheme();
        });

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                this.navigateTo(item.dataset.page);
            });
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            localStorage.removeItem('auth_token');
            location.reload();
        });
    }

    async loadUser() {
        if (!this.token) {
            this.showLogin();
            return;
        }

        try {
            const response = await fetch('/.netlify/functions/api/login/verify', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.user = data.user;
                document.getElementById('userName').textContent = data.user.name;
            } else {
                localStorage.removeItem('auth_token');
                this.showLogin();
            }
        } catch (error) {
            this.showLogin();
        }
    }

    showLogin() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal">
                <h2>تسجيل الدخول</h2>
                <form id="loginForm">
                    <div class="form-group">
                        <label>البريد الإلكتروني</label>
                        <input type="email" id="loginEmail" required placeholder="admin@smartapp.com" />
                    </div>
                    <div class="form-group">
                        <label>كلمة المرور</label>
                        <input type="password" id="loginPassword" required placeholder="••••••••" />
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="btn btn-primary">دخول</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            try {
                const response = await fetch('/.netlify/functions/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();
                if (response.ok) {
                    localStorage.setItem('auth_token', data.token);
                    this.token = data.token;
                    this.user = data.user;
                    document.getElementById('userName').textContent = data.user.name;
                    modal.remove();
                    await this.navigateTo('dashboard');
                } else {
                    alert(data.error || 'فشل تسجيل الدخول');
                }
            } catch (error) {
                alert('خطأ في الاتصال بالخادم');
            }
        });
    }

    async apiRequest(endpoint, method = 'GET', body = null) {
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) options.body = JSON.stringify(body);

        const response = await fetch(`/.netlify/functions/api${endpoint}`, options);
        return response;
    }

    async navigateTo(page) {
        this.currentPage = page;
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        const content = document.getElementById('content');
        
        switch(page) {
            case 'dashboard':
                await this.renderDashboard(content);
                break;
            case 'subscriptions':
                await this.renderSubscriptions(content);
                break;
            case 'devices':
                await this.renderDevices(content);
                break;
            case 'create':
                await this.renderCreate(content);
                break;
            default:
                content.innerHTML = '<h2>الصفحة غير موجودة</h2>';
        }
    }

    // ============================================
    // Dashboard
    // ============================================
    async renderDashboard(container) {
        const stats = await this.getStats();
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="label">👥 المستخدمين</div>
                    <div class="value">${stats.users || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="label">🔑 الاشتراكات النشطة</div>
                    <div class="value">${stats.activeSubscriptions || 0}</div>
                    <div class="sub">إجمالي: ${stats.subscriptions || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="label">📱 الأجهزة النشطة</div>
                    <div class="value">${stats.activeDevices || 0}</div>
                    <div class="sub">إجمالي: ${stats.devices || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="label">⏰ تنتهي قريباً</div>
                    <div class="value" style="color: var(--warning);">${stats.expiringSoon || 0}</div>
                    <div class="sub">خلال 7 أيام</div>
                </div>
            </div>
            
            <div class="table-container">
                <div class="table-header">
                    <h3>آخر الاشتراكات</h3>
                </div>
                <div id="recentSubscriptions">
                    ${await this.getRecentSubscriptions()}
                </div>
            </div>
        `;
    }

    async getStats() {
        try {
            const response = await this.apiRequest('/stats');
            return await response.json();
        } catch {
            return { users: 0, subscriptions: 0, activeSubscriptions: 0, devices: 0, activeDevices: 0, expiringSoon: 0 };
        }
    }

    async getRecentSubscriptions() {
        try {
            const response = await this.apiRequest('/subscriptions');
            const subs = await response.json();
            
            if (!subs || subs.length === 0) {
                return '<p style="padding:20px;color:var(--text-secondary);">لا توجد اشتراكات</p>';
            }

            return `
                <table>
                    <thead>
                        <tr>
                            <th>المفتاح</th>
                            <th>الباقة</th>
                            <th>المستخدم</th>
                            <th>الأجهزة</th>
                            <th>تاريخ الانتهاء</th>
                            <th>الحالة</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${subs.slice(0, 10).map(sub => `
                            <tr>
                                <td><code style="background:var(--bg-primary);padding:4px 8px;border-radius:4px;">${sub.license_key}</code></td>
                                <td>${sub.package_name}</td>
                                <td>${sub.users?.name || 'غير محدد'}</td>
                                <td>${sub.devices_count || 0}/${sub.max_devices}</td>
                                <td>${new Date(sub.end_date).toLocaleDateString('ar-EG')}</td>
                                <td><span class="status-badge ${sub.status}">${sub.status}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } catch {
            return '<p style="padding:20px;color:var(--text-secondary);">خطأ في تحميل البيانات</p>';
        }
    }

    // ============================================
    // Subscriptions
    // ============================================
    async renderSubscriptions(container) {
        const response = await this.apiRequest('/subscriptions');
        const subs = await response.json();

        container.innerHTML = `
            <div class="table-container">
                <div class="table-header">
                    <h2>📋 جميع الاشتراكات</h2>
                    <div class="filters">
                        <input type="text" placeholder="بحث..." id="searchSub" />
                        <select id="filterStatus">
                            <option value="all">الكل</option>
                            <option value="active">نشط</option>
                            <option value="expired">منتهي</option>
                            <option value="suspended">موقوف</option>
                        </select>
                        <button class="btn btn-primary" onclick="app.refreshData()">
                            <i class="fas fa-sync"></i>
                        </button>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>المفتاح</th>
                            <th>الباقة</th>
                            <th>المستخدم</th>
                            <th>الأجهزة</th>
                            <th>تاريخ البدء</th>
                            <th>تاريخ الانتهاء</th>
                            <th>الحالة</th>
                            <th>الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${subs?.map(sub => `
                            <tr>
                                <td><code style="background:var(--bg-primary);padding:4px 8px;border-radius:4px;font-size:12px;">${sub.license_key}</code></td>
                                <td><span style="text-transform:capitalize;">${sub.package_name}</span></td>
                                <td>${sub.users?.name || 'غير محدد'}</td>
                                <td>${sub.devices_count || 0}/${sub.max_devices}</td>
                                <td>${new Date(sub.start_date).toLocaleDateString('ar-EG')}</td>
                                <td>${new Date(sub.end_date).toLocaleDateString('ar-EG')}</td>
                                <td><span class="status-badge ${sub.status}">${sub.status}</span></td>
                                <td>
                                    <button class="btn btn-success btn-sm" onclick="app.renewSubscription('${sub.id}')">
                                        <i class="fas fa-sync"></i>
                                    </button>
                                    <button class="btn btn-danger btn-sm" onclick="app.deleteSubscription('${sub.id}')">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // ============================================
    // Devices
    // ============================================
    async renderDevices(container) {
        const response = await this.apiRequest('/devices');
        const devices = await response.json();

        container.innerHTML = `
            <div class="table-container">
                <div class="table-header">
                    <h2>📱 الأجهزة المسجلة</h2>
                    <button class="btn btn-primary" onclick="app.refreshData()">
                        <i class="fas fa-sync"></i>
                    </button>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>الجهاز</th>
                            <th>المفتاح</th>
                            <th>الباقة</th>
                            <th>Android</th>
                            <th>آخر اتصال</th>
                            <th>الحالة</th>
                            <th>الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${devices?.map(device => `
                            <tr>
                                <td>${device.device_name || 'غير معروف'}</td>
                                <td><code style="background:var(--bg-primary);padding:2px 6px;border-radius:4px;font-size:11px;">${device.subscriptions?.license_key || 'N/A'}</code></td>
                                <td>${device.subscriptions?.package_name || 'N/A'}</td>
                                <td>${device.android_version || 'N/A'}</td>
                                <td>${device.last_seen ? new Date(device.last_seen).toLocaleString('ar-EG') : 'غير معروف'}</td>
                                <td><span class="status-badge ${device.status}">${device.status}</span></td>
                                <td>
                                    ${device.status === 'blocked' 
                                        ? `<button class="btn btn-success btn-sm" onclick="app.unblockDevice('${device.id}')">إلغاء الحظر</button>`
                                        : `<button class="btn btn-danger btn-sm" onclick="app.blockDevice('${device.id}')">حظر</button>`
                                    }
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // ============================================
    // Create Subscription
    // ============================================
    renderCreate(container) {
        container.innerHTML = `
            <div style="max-width: 500px; margin: 0 auto; background: var(--bg-card); padding: 32px; border-radius: var(--radius); border: 1px solid var(--border);">
                <h2 style="margin-bottom: 24px;">➕ إنشاء اشتراك جديد</h2>
                <form id="createForm">
                    <div class="form-group">
                        <label>الباقة</label>
                        <select id="packageName" required>
                            <option value="basic">Basic</option>
                            <option value="premium">Premium</option>
                            <option value="pro">Pro</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>عدد الأجهزة</label>
                        <input type="number" id="maxDevices" value="1" min="1" max="10" required />
                    </div>
                    <div class="form-group">
                        <label>المدة (أيام)</label>
                        <input type="number" id="duration" value="30" min="1" required />
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="autoRenew" />
                            تجديد تلقائي
                        </label>
                    </div>
                    <div class="form-group">
                        <label>المستخدم (ID)</label>
                        <input type="text" id="userId" placeholder="أدخل User ID" required />
                    </div>
                    <button type="submit" class="btn btn-success" style="width:100%;">
                        <i class="fas fa-plus"></i> إنشاء اشتراك
                    </button>
                </form>
            </div>
        `;

        document.getElementById('createForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createSubscription();
        });
    }

    async createSubscription() {
        const userId = document.getElementById('userId').value;
        const packageName = document.getElementById('packageName').value;
        const maxDevices = parseInt(document.getElementById('maxDevices').value);
        const duration = parseInt(document.getElementById('duration').value);
        const autoRenew = document.getElementById('autoRenew').checked;

        if (!userId) {
            alert('الرجاء إدخال User ID');
            return;
        }

        try {
            const response = await this.apiRequest('/subscriptions/create', 'POST', {
                userId,
                packageName,
                maxDevices,
                duration,
                autoRenew
            });

            const data = await response.json();
            if (response.ok) {
                alert(`✅ تم إنشاء الاشتراك بنجاح!\nالمفتاح: ${data.subscription.license_key}`);
                this.navigateTo('subscriptions');
            } else {
                alert(data.error || 'فشل إنشاء الاشتراك');
            }
        } catch (error) {
            alert('خطأ في الاتصال بالخادم');
        }
    }

    // ============================================
    // Actions
    // ============================================
    async renewSubscription(id) {
        if (!confirm('هل تريد تجديد هذا الاشتراك؟')) return;
        
        try {
            const response = await this.apiRequest('/subscriptions/renew', 'POST', {
                subscriptionId: id,
                duration: 30
            });
            
            if (response.ok) {
                alert('✅ تم تجديد الاشتراك بنجاح');
                this.navigateTo('subscriptions');
            }
        } catch (error) {
            alert('فشل تجديد الاشتراك');
        }
    }

    async deleteSubscription(id) {
        if (!confirm('هل أنت متأكد من حذف هذا الاشتراك؟')) return;
        
        try {
            const response = await this.apiRequest(`/subscriptions/${id}`, 'DELETE');
            if (response.ok) {
                alert('✅ تم حذف الاشتراك');
                this.navigateTo('subscriptions');
            }
        } catch (error) {
            alert('فشل حذف الاشتراك');
        }
    }

    async blockDevice(id) {
        if (!confirm('هل تريد حظر هذا الجهاز؟')) return;
        
        try {
            const response = await this.apiRequest('/devices/block', 'POST', { deviceId: id });
            if (response.ok) {
                this.navigateTo('devices');
            }
        } catch (error) {
            alert('فشل حظر الجهاز');
        }
    }

    async unblockDevice(id) {
        try {
            const response = await this.apiRequest('/devices/unblock', 'POST', { deviceId: id });
            if (response.ok) {
                this.navigateTo('devices');
            }
        } catch (error) {
            alert('فشل إلغاء الحظر');
        }
    }

    refreshData() {
        this.navigateTo(this.currentPage);
    }
}

// ============================================
// تشغيل التطبيق
// ============================================
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SubscriptionManager();
    window.app = app;
});