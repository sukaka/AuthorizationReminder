import { app } from './app.js'

const port = Number(process.env.PORT || 5192)

app.listen(port, () => {
  console.log(`Big-screen backend listening on port ${port}`)
})
