const [index, count] = (process.env.SHARD ?? '1/1').split('/').map(Number)

export const inShard = position => position % count === index - 1

export const shard = items => items.filter((_, position) => inShard(position))
