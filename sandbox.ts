import { Database } from 'bun:sqlite'
import { MyWallet } from './index.ts'

const db = new Database(':memory:')
const wallet = new MyWallet(db)
await wallet.init()

const result = await wallet.addTransaction('user1', -100n).catch((err) => err)
console.log(result)
