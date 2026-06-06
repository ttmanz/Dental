const { WebSocketServer, OPEN } = require('ws')
const jwt = require('jsonwebtoken')

let wss = null

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    // Authenticate via ?token= query param
    try {
      const url    = new URL(req.url, 'http://x')
      const token  = url.searchParams.get('token')
      const claims = jwt.verify(token, process.env.JWT_SECRET)
      ws.practiceId = claims.practiceId
      ws.userId     = claims.userId
      ws.isAlive    = true
    } catch {
      ws.close(4001, 'Unauthorised')
      return
    }

    ws.on('pong', () => { ws.isAlive = true })
    ws.on('error', () => {})
  })

  // Heartbeat — drop dead clients every 30 s
  const hb = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) { ws.terminate(); return }
      ws.isAlive = false
      ws.ping()
    })
  }, 30_000)

  wss.on('close', () => clearInterval(hb))
  console.log('WebSocket server attached on /ws')
}

function broadcast(type, data, practiceId) {
  if (!wss) return
  const msg = JSON.stringify({ type, data })
  wss.clients.forEach(ws => {
    if (ws.readyState === OPEN && ws.practiceId === practiceId) {
      ws.send(msg)
    }
  })
}

module.exports = { initWebSocket, broadcast }
