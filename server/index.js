const express = require('express');
const cors = require('cors');
const path = require('path');

const CoupangAPI = require('./platforms/coupang');
const NaverCommerceAPI = require('./platforms/naver');
const Cafe24API = require('./platforms/cafe24');

const app = express();
app.use(cors());
app.use(express.json());

// 정적 파일 서빙 (프론트엔드)
app.use(express.static(path.join(__dirname, '..')));

// 플랫폼 인스턴스 저장소 (메모리)
const platforms = {
  coupang: null,
  naver: null,
  cafe24: null
};

// ──────────────────────────────────
// 설정 API
// ──────────────────────────────────

/** 쿠팡 설정 */
app.post('/api/config/coupang', (req, res) => {
  const { accessKey, secretKey, vendorId } = req.body;
  if (!accessKey || !secretKey || !vendorId) {
    return res.status(400).json({ error: 'accessKey, secretKey, vendorId 모두 필요합니다.' });
  }
  platforms.coupang = new CoupangAPI(accessKey, secretKey, vendorId);
  res.json({ success: true, message: '쿠팡 설정 완료' });
});

/** 네이버 설정 */
app.post('/api/config/naver', (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'clientId, clientSecret 모두 필요합니다.' });
  }
  platforms.naver = new NaverCommerceAPI(clientId, clientSecret);
  res.json({ success: true, message: '네이버 설정 완료' });
});

/** 카페24 설정 */
app.post('/api/config/cafe24', (req, res) => {
  const { mallId, clientId, clientSecret, accessToken, refreshToken } = req.body;
  if (!mallId || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'mallId, clientId, clientSecret 모두 필요합니다.' });
  }
  platforms.cafe24 = new Cafe24API(mallId, clientId, clientSecret);
  if (accessToken && refreshToken) {
    platforms.cafe24.setTokens(accessToken, refreshToken, 3600);
  }
  res.json({ success: true, message: '카페24 설정 완료' });
});

/** 카페24 OAuth 인증 URL */
app.get('/api/config/cafe24/auth-url', (req, res) => {
  if (!platforms.cafe24) {
    return res.status(400).json({ error: '카페24 기본 설정을 먼저 해주세요.' });
  }
  const redirectUri = req.query.redirect_uri || `${req.protocol}://${req.get('host')}/api/config/cafe24/callback`;
  const url = platforms.cafe24.getAuthorizationUrl(redirectUri);
  res.json({ url });
});

/** 카페24 OAuth 콜백 */
app.get('/api/config/cafe24/callback', async (req, res) => {
  try {
    if (!platforms.cafe24) {
      return res.status(400).send('카페24 기본 설정을 먼저 해주세요.');
    }
    const { code } = req.query;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/config/cafe24/callback`;
    const tokenData = await platforms.cafe24.getTokenFromCode(code, redirectUri);
    res.send(`<h2>카페24 인증 완료!</h2><p>이 창을 닫고 대시보드로 돌아가세요.</p><script>window.close();</script>`);
  } catch (err) {
    res.status(500).send(`인증 실패: ${err.message}`);
  }
});

// ──────────────────────────────────
// 주문 조회 API
// ──────────────────────────────────

/** 쿠팡 주문 조회 */
app.get('/api/orders/coupang', async (req, res) => {
  try {
    if (!platforms.coupang) {
      return res.status(400).json({ error: '쿠팡 API가 설정되지 않았습니다.' });
    }
    const { from, to, status } = req.query;
    const orders = await platforms.coupang.getOrders(from, to, status || 'ACCEPT');
    res.json({ success: true, platform: 'coupang', count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ error: `쿠팡 주문 조회 실패: ${err.message}` });
  }
});

/** 네이버 주문 조회 */
app.get('/api/orders/naver', async (req, res) => {
  try {
    if (!platforms.naver) {
      return res.status(400).json({ error: '네이버 API가 설정되지 않았습니다.' });
    }
    const { from, to, status } = req.query;
    const orders = await platforms.naver.getOrders(from, to, status || 'PAYED');
    res.json({ success: true, platform: 'naver', count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ error: `네이버 주문 조회 실패: ${err.message}` });
  }
});

/** 카페24 주문 조회 */
app.get('/api/orders/cafe24', async (req, res) => {
  try {
    if (!platforms.cafe24) {
      return res.status(400).json({ error: '카페24 API가 설정되지 않았습니다.' });
    }
    const { from, to, status } = req.query;
    const orders = await platforms.cafe24.getOrders(from, to, status || 'N20');
    res.json({ success: true, platform: 'cafe24', count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ error: `카페24 주문 조회 실패: ${err.message}` });
  }
});

/** 전체 플랫폼 주문 통합 조회 */
app.get('/api/orders/all', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from, to 날짜 파라미터가 필요합니다.' });
  }

  const results = { orders: [], errors: [] };

  const tasks = [];

  if (platforms.coupang) {
    tasks.push(
      platforms.coupang.getOrders(from, to)
        .then(orders => results.orders.push(...orders))
        .catch(err => results.errors.push({ platform: 'coupang', error: err.message }))
    );
  }

  if (platforms.naver) {
    tasks.push(
      platforms.naver.getOrders(from, to)
        .then(orders => results.orders.push(...orders))
        .catch(err => results.errors.push({ platform: 'naver', error: err.message }))
    );
  }

  if (platforms.cafe24) {
    tasks.push(
      platforms.cafe24.getOrders(from, to)
        .then(orders => results.orders.push(...orders))
        .catch(err => results.errors.push({ platform: 'cafe24', error: err.message }))
    );
  }

  await Promise.all(tasks);

  // 주문일시 기준 최신순 정렬
  results.orders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

  res.json({
    success: true,
    totalCount: results.orders.length,
    orders: results.orders,
    errors: results.errors
  });
});

// ──────────────────────────────────
// 서버 시작
// ──────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`주문 수집 서버 실행 중: http://localhost:${PORT}`);
  console.log(`대시보드: http://localhost:${PORT}/orders.html`);
});
