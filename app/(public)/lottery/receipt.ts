import 'server-only'

import QRCode from 'qrcode'

export interface LotteryReceipt {
  prizeTitle: string
  receiptCode: string | null
  receiptQr: string | null
  claimed: boolean
}

export async function lotteryReceipt(
  draw: { prizeTitle: string; receiptCode: string | null; claimedAt: number | null } | null,
): Promise<LotteryReceipt | null> {
  if (!draw) return null
  return {
    prizeTitle: draw.prizeTitle,
    receiptCode: draw.receiptCode,
    receiptQr: draw.receiptCode
      ? await QRCode.toDataURL(`NBTLOTTERY:${draw.receiptCode}`, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 360,
        })
      : null,
    claimed: draw.claimedAt !== null,
  }
}
