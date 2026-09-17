import fieldStyles from '@/components/ui/Field.module.css'
import styles from './LoadoutSubmitForm.module.css'

export function LoadoutShotField({
  error,
  onPick,
}: {
  error: string | undefined
  onPick: (update: (current: string | null) => string | null) => void
}) {
  return (
    <div className={styles.shotField}>
      <label className={fieldStyles.label} htmlFor="loadout-shot">
        改装截图<span className={fieldStyles.required}>*</span>
        <span className={fieldStyles.hint}>
          在改枪台截一张，能看清改装后的枪和右侧属性（电脑 Win+Shift+S，手机直接截屏）
        </span>
      </label>
      <input
        id="loadout-shot"
        name="shot"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        required
        onChange={event => {
          const file = event.target.files?.[0]
          onPick(current => {
            if (current) URL.revokeObjectURL(current)
            return file ? URL.createObjectURL(file) : null
          })
        }}
      />

      {error ? (
        <p className={fieldStyles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
