const axios = require('axios');

class Cafe24API {
  constructor(mallId, clientId, clientSecret) {
    this.mallId = mallId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = `https://${mallId}.cafe24api.com/api/v2`;
    this.token = null;
    this.tokenExpiry = null;
    this.refreshToken = null;
  }

  /**
   * 초기 Access Token 설정 (OAuth 인증 후 받은 토큰)
   * 카페24는 OAuth 2.0 Authorization Code 플로우 사용
   * 최초 1회 브라우저에서 인증 필요
   */
  setTokens(accessToken, refreshToken, expiresIn) {
    this.token = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
  }

  /**
   * Access Token 갱신
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('Refresh token이 없습니다. OAuth 인증을 먼저 진행해주세요.');
    }

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', this.refreshToken);

    const response = await axios.post(
      `https://${this.mallId}.cafe24api.com/api/v2/oauth/token`,
      params,
      {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    this.token = response.data.access_token;
    this.refreshToken = response.data.refresh_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

    return {
      accessToken: this.token,
      refreshToken: this.refreshToken,
      expiresIn: response.data.expires_in
    };
  }

  /**
   * API 요청 (자동 토큰 갱신)
   */
  async request(method, path, params = {}) {
    // 토큰 만료 시 자동 갱신
    if (this.tokenExpiry && Date.now() >= this.tokenExpiry) {
      await this.refreshAccessToken();
    }

    if (!this.token) {
      throw new Error('Access token이 설정되지 않았습니다.');
    }

    const config = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'X-Cafe24-Api-Version': '2024-06-01'
      }
    };

    if (method === 'GET' && Object.keys(params).length > 0) {
      config.params = params;
    } else if (method !== 'GET') {
      config.data = params;
    }

    const response = await axios(config);
    return response.data;
  }

  /**
   * 주문 목록 조회
   * @param {string} startDate - 조회 시작일 (YYYY-MM-DD)
   * @param {string} endDate - 조회 종료일 (YYYY-MM-DD)
   * @param {string} orderStatus - 주문 상태 코드
   */
  async getOrders(startDate, endDate, orderStatus = 'N20') {
    const params = {
      start_date: startDate,
      end_date: endDate,
      order_status: orderStatus,
      limit: 100,
      embed: 'items,receivers'
    };

    const result = await this.request('GET', '/admin/orders', params);
    const orders = result.orders || [];
    return this.normalizeOrders(orders);
  }

  /**
   * 주문 데이터 정규화
   */
  normalizeOrders(orders) {
    return orders.map(order => {
      const item = order.items?.[0] || {};
      const receiver = order.receivers?.[0] || {};

      return {
        platform: 'cafe24',
        platformName: '카페24',
        orderId: order.order_id || '',
        orderDate: order.order_date || '',
        status: this.translateStatus(order.order_status),
        rawStatus: order.order_status || '',
        buyerName: order.buyer_name || '',
        buyerPhone: order.buyer_phone || order.buyer_cellphone || '',
        receiverName: receiver.name || '',
        receiverPhone: receiver.phone || receiver.cellphone || '',
        address: `${receiver.address1 || ''} ${receiver.address2 || ''}`.trim(),
        zipCode: receiver.zipcode || '',
        productName: item.product_name || '',
        quantity: item.quantity || 1,
        totalPrice: order.actual_payment_amount || order.order_price_amount || 0,
        deliveryMessage: receiver.shipping_message || '',
        rawData: order
      };
    });
  }

  translateStatus(status) {
    const map = {
      'N00': '입금전',
      'N10': '입금대기',
      'N20': '결제완료',
      'N21': '결제확인',
      'N22': '배송접수',
      'N30': '배송준비중',
      'N40': '배송중',
      'N50': '배송완료',
      'C00': '취소신청',
      'C10': '취소접수',
      'C34': '취소완료',
      'R00': '반품신청',
      'R10': '반품접수',
      'R34': '반품완료',
      'E00': '교환신청',
      'E10': '교환접수',
      'E34': '교환완료'
    };
    return map[status] || status;
  }

  /**
   * OAuth 인증 URL 생성
   * 사용자가 이 URL로 이동하여 앱 접근을 허용해야 함
   */
  getAuthorizationUrl(redirectUri, state = '') {
    return `https://${this.mallId}.cafe24api.com/api/v2/oauth/authorize` +
      `?response_type=code` +
      `&client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=mall.read_store,mall.read_order` +
      `&state=${state}`;
  }

  /**
   * Authorization Code로 Access Token 발급
   */
  async getTokenFromCode(code, redirectUri) {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    const response = await axios.post(
      `https://${this.mallId}.cafe24api.com/api/v2/oauth/token`,
      params,
      {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    this.setTokens(
      response.data.access_token,
      response.data.refresh_token,
      response.data.expires_in
    );

    return response.data;
  }
}

module.exports = Cafe24API;
