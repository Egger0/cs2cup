import { Badge, Button, Empty, Field, Toast } from '@/components/ui'

export default function Home() {
  return (
    <main className="wrap section">
      <Badge tone="ct" dot>
        报名开放中
      </Badge>
      <Button variant="primary">立即报名参赛</Button>
      <Field id="team" label="战队名称" required hint="2–20 字符" />
      <Empty>还没有战队报名</Empty>
      <Toast open={false} title="✔ 报名已提交" message="战队已入库" />
    </main>
  )
}
