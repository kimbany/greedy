const axios = require('axios');

class NaverCommerceAPI {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = 'https://api.commerce.naver.com';
    this.token = null;
    this.tokenExpiry = null;
  }

  /**
   * OAuth 토큰 발급
   */
  async getAccessToken() {
    // 토큰이 유효하면 재사용
    if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const timestamp = Date.now();
    // 클라이언트 ID + 밀리초 타임스탬프를 Base64 인코딩
    const clientSecretSign = Buffer.from(
      `${this.clientId}_${timestamp}`
    ).toString('base64');

    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('timestamp', timestamp);
    params.append('client_secret_sign', clientSecretSign);
    params.append('grant_type', 'client_credentials');
    params.append('type', 'SELF');

    const response = await axios.post(
      `${this.baseUrl}/external/v1/oauth2/token`,
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    this.token = response.data.access_token;
    // 토큰 만료 1분 전에 갱신하도록 설정
    this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
    return this.token;
  }

  /**
   * API 요청 (자동 토큰 관리)
   */
  async request(method, path, data = null) {
    const token = await this.getAccessToken();

    const config = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      if (method === 'GET') {
        config.params = data;
      } else {
        config.data = data;
      }
    }

    const response = await axios(config);
    return response.data;
  }

  /**
   * 주문 목록 조회 (상품 주문 기반)
   * @param {string} fromDate - 조회 시작일시 (ISO 8601)
   * @param {string} toDate - 조회 종료일시 (ISO 8601)
   * @param {string} orderStatus - 주문 상태 필터
   */
  async getOrders(fromDate, toDate, orderStatus = 'PAYED') {
    const searchBody = {
      searchDateType: 'PAY_DATE',
      fromDate,
      toDate,
      orderStatusList: [orderStatus]
    };

    const result = await this.request(
      'POST',
      '/external/v1/pay-order/seller/product-orders/query',
      searchBody
    );

    const productOrders = result.data?.contents || [];
    return this.normalizeOrders(productOrders);
  }

  /**
   * 주문 데이터 정규화
   */
  normalizeOrders(orders) {
    return orders.map(item => {
      const order = item.order || {};
      const productOrder = item.productOrder || {};
      const delivery = item.delivery || {};
      const shippingAddress = delivery.shippingAddress || order.shippingAddress || {};

      return {
        platform: 'naver',
        platformName: '네이버',
        orderId: order.orderId || productOrder.productOrderId || '',
        productOrderId: productOrder.productOrderId || '',
        orderDate: order.paymentDate || order.orderDate || '',
        status: this.translateStatus(productOrder.productOrderStatus),
        rawStatus: productOrder.productOrderStatus || '',
        buyerName: order.ordererName || '',
        buyerPhone: order.ordererTel || '',
        receiverName: shippingAddress.name || '',
        receiverPhone: shippingAddress.tel1 || '',
        address: `${shippingAddress.baseAddress || ''} ${shippingAddress.detailedAddress || ''}`.trim(),
        zipCode: shippingAddress.zipCode || '',
        productName: productOrder.productName || '',
        quantity: productOrder.quantity || 1,
        totalPrice: productOrder.totalPaymentAmount || 0,
        deliveryMessage: shippingAddress.deliveryMemo || '',
        rawData: item
      };
    });
  }

  translateStatus(status) {
    const map = {
      'PAYED': '결제완료',
      'DELIVERING': '배송중',
      'DELIVERED': '배송완료',
      'PURCHASE_DECIDED': '구매확정',
      'EXCHANGED': '교환완료',
      'CANCELED': '취소완료',
      'RETURNED': '반품완료',
      'NOT_YET': '미결제'
    };
    return map[status] || status;
  }
}

module.exports = NaverCommerceAPI;
