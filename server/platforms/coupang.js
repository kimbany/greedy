const crypto = require('crypto');
const axios = require('axios');

class CoupangAPI {
  constructor(accessKey, secretKey, vendorId) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.vendorId = vendorId;
    this.baseUrl = 'https://api-gateway.coupang.com';
  }

  /**
   * HMAC 서명 생성 (쿠팡 WING API 인증)
   */
  generateSignature(method, path, datetime) {
    const message = datetime + method + path;
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(message)
      .digest('hex');

    return `CEA algorithm=HmacSHA256, access-key=${this.accessKey}, signed-date=${datetime}, signature=${signature}`;
  }

  /**
   * API 요청
   */
  async request(method, path, params = {}) {
    const datetime = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    // 쿼리 스트링 생성
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const fullPath = queryString ? `${path}?${queryString}` : path;

    const authorization = this.generateSignature(method, fullPath, datetime);

    const response = await axios({
      method,
      url: `${this.baseUrl}${fullPath}`,
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-By': 'greedy-order-collector'
      }
    });

    return response.data;
  }

  /**
   * 주문 목록 조회
   * @param {string} status - ACCEPT, INSTRUCT, DEPARTURE, DELIVERING, FINAL_DELIVERY 등
   * @param {string} createdAtFrom - 조회 시작일 (yyyy-MM-dd)
   * @param {string} createdAtTo - 조회 종료일 (yyyy-MM-dd)
   */
  async getOrders(createdAtFrom, createdAtTo, status = 'ACCEPT') {
    const path = `/v2/providers/openapi/apis/api/v4/vendors/${this.vendorId}/ordersheets`;
    const params = {
      createdAtFrom,
      createdAtTo,
      status
    };

    const result = await this.request('GET', path, params);
    return this.normalizeOrders(result.data || []);
  }

  /**
   * 주문 데이터 정규화
   */
  normalizeOrders(orders) {
    return orders.map(order => ({
      platform: 'coupang',
      platformName: '쿠팡',
      orderId: String(order.orderId),
      orderDate: order.orderedAt,
      status: this.translateStatus(order.status),
      rawStatus: order.status,
      buyerName: order.receiver?.name || order.orderer?.name || '',
      buyerPhone: order.receiver?.phone || '',
      receiverName: order.receiver?.name || '',
      receiverPhone: order.receiver?.phone || '',
      address: order.receiver
        ? `${order.receiver.addr1 || ''} ${order.receiver.addr2 || ''}`.trim()
        : '',
      zipCode: order.receiver?.postCode || '',
      productName: order.items?.[0]?.vendorItemName || '',
      quantity: order.items?.[0]?.shippingCount || 1,
      totalPrice: order.orderPrice || 0,
      deliveryMessage: order.parcelPrintMessage || '',
      rawData: order
    }));
  }

  translateStatus(status) {
    const map = {
      'ACCEPT': '결제완료',
      'INSTRUCT': '상품준비중',
      'DEPARTURE': '배송시작',
      'DELIVERING': '배송중',
      'FINAL_DELIVERY': '배송완료'
    };
    return map[status] || status;
  }
}

module.exports = CoupangAPI;
