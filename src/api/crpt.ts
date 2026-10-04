const CRPT_HOST = 'https://mobile.api.crpt.ru'

export type CrptPackLevel = 'inner-pack' | 'trade-unit' | string

export interface CrptCheckAbstractResult {
  category: 'gtin' | string
  checkDate: number
  checkResult: boolean
  code: string
  codeFounded: boolean
  codeType: 'ean13' | string
  id: number
  wrongDocs: boolean
}

export interface CrptCheckSuccessResult extends CrptCheckAbstractResult {
  catalogData: {
    brand_id: number
    brand_name: string
    categories: {
      cat_id: number
      cat_name: string
    }[]
    create_date: string
    first_sign_date: string
    good_attrs: {
      attr_group_id: number
      attr_group_name: string
      attr_id: number
      attr_name: string
      attr_value: string
      attr_value_type: string
      gtin?: string
      level?: CrptPackLevel
      multiplier?: string
      published_date: string
      value: number
    }[]
    good_id: number
    good_images: unknown[]
    good_name: number
    good_prices: unknown[]
    good_reviews: unknown[]
    good_reviews_count: number
    good_status: 'published' | string,
    good_url: string
    identified_by: {
      level: CrptPackLevel
      multiplier: number
      type: string
      value: string
    }[]
    is_kit: boolean
    is_set: boolean
    is_tech_gtin: boolean
    producer_inn: string
    producer_name: string
    roskachestvo: {
      criteria_ratings: {
        title: string
        value: number
      }[]
      has_quality_mark: number
      product_documents: string
      product_link: string
      roskachestvo_id: number
      total_rating: number
    }
    set_gtins: unknown[]
    update_date: string
  }[]
  codeFounded: true
  gtin: string
  productName: string
}

export interface CrptCheckNotFoundResult extends CrptCheckAbstractResult {
  cis: string
  codeFounded: false
  status: 'not_found'
  statusV2: 'not_found'
  targetComplaintKind: 'NO_MARKING'
  warning: 'not_found'
}

export type CrptCheckResult = CrptCheckNotFoundResult | CrptCheckSuccessResult

export class CrptCheckV2InvalidDataMatrixError extends Error {}

export interface CrptCheckV2AbstractScreenItem {
  itemType: string
  order: number
}

export interface CrptCheckV2MainScreenItem extends CrptCheckV2AbstractScreenItem {
  chips: {
    chipType: string
    order: string
    value: string
  }[]
  itemType: 'main_card'
  statusCard: {
    complaintButton: boolean
    description: string
    statusType: string
    title: string
  }
  title: string
}

export interface CrptCheckV2NutritionScreenItem extends CrptCheckV2AbstractScreenItem {
  itemType: 'nutrition_card'
}

export type CrptCheckV2ScreenItem = CrptCheckV2MainScreenItem | CrptCheckV2NutritionScreenItem

export interface CrptCheckV2Result {
  category: string
  categoryV2: string
  checkDate: number
  code: string
  codeFounded: boolean
  codeType: 'datamatrix' | string
  context: 'scan' | string
  country: number
  emissionType: 'LOCAL' | string
  expireDate: number
  gtin: string
  id: number
  introducedDate: number
  isBlocked: boolean
  known: boolean
  outerStatus: 'RETIRED' | string
  packType: 'UNIT' | string
  paymentGroup: number
  producedDate: number
  productName: string
  receiptDate: number
  salePointData: {
    address: string
    fiscalDriveNumber: string
    idSp: string
    inn: string
    legalEntity: string
    placeLat: number
    placeLng: number
    storeName: string
    storeType: 'offline' | string
  }
  screen: {
    items: CrptCheckV2ScreenItem[]
  }
  serial: string
  status: 'item_sold_receipt' | 'wrong' | string
  statusV2: 'item_sold_receipt' | 'wrong' | string
  tnvd: string
  verified: boolean
  vsdStatus: 'CONFIRMED' | string
  withdrawReason: 'RETAIL' | string
  wrongDocs: boolean
}

export class CrptAPI {
  async checkDataMatrix (dataMatrix: string): Promise<CrptCheckV2Result> {
    const response = await fetch(`${CRPT_HOST}/v2/mobile/check`, {
      body: JSON.stringify({
        code: dataMatrix,
        codeType: 'datamatrix',
        context: 'scan'
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST'
    })
    if (response.status === 400) {
      const responseJson = await response.json()
      throw new CrptCheckV2InvalidDataMatrixError(responseJson.msg)
    }
    if (response.status !== 200) {
      throw new Error(`request failed: ${response.status} ${await response.text()}`)
    }
    return await response.json()
  }

  async checkEan (ean: string): Promise<CrptCheckResult> {
    const response = await fetch(`${CRPT_HOST}/mobile/check`, {
      body: JSON.stringify({
        code: ean,
        codeType: 'ean13',
        context: 'scan'
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST'
    })
    if (response.status !== 200) {
      throw new Error(`request failed: ${await response.text()}`)
    }
    return await response.json()
  }
}
