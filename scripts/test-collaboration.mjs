import assert from 'node:assert/strict'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const serverUrl = process.env.COLLABORATION_URL ?? 'ws://127.0.0.1:8787/collaboration'
const roomName = `integration-${Date.now()}`
const expectedText = `Shared at ${new Date().toISOString()}`
const expectedComment = {
  id: crypto.randomUUID(),
  author: 'Integration test',
  body: 'Shared comment',
}

const firstDocument = new Y.Doc()
const secondDocument = new Y.Doc()
const firstProvider = new WebsocketProvider(serverUrl, roomName, firstDocument, {
  WebSocketPolyfill: WebSocket,
})
const secondProvider = new WebsocketProvider(serverUrl, roomName, secondDocument, {
  WebSocketPolyfill: WebSocket,
})

const waitForSync = (provider) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for sync')), 5_000)
    provider.once('sync', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

const waitForText = (sharedText, expected) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for "${expected}"`)),
      5_000,
    )
    const check = () => {
      if (sharedText.toString() !== expected) return
      clearTimeout(timeout)
      sharedText.unobserve(check)
      resolve()
    }

    sharedText.observe(check)
    check()
  })

const waitForComment = (comments, expectedId) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for comment')), 5_000)
    const check = () => {
      if (!comments.has(expectedId)) return
      clearTimeout(timeout)
      comments.unobserve(check)
      resolve()
    }

    comments.observe(check)
    check()
  })

try {
  await Promise.all([waitForSync(firstProvider), waitForSync(secondProvider)])
  const firstText = firstDocument.getText('content')
  const secondText = secondDocument.getText('content')
  const firstComments = firstDocument.getMap('comments')
  const secondComments = secondDocument.getMap('comments')
  const received = waitForText(secondText, expectedText)
  const receivedComment = waitForComment(secondComments, expectedComment.id)

  firstText.insert(0, expectedText)
  firstComments.set(expectedComment.id, expectedComment)
  await Promise.all([received, receivedComment])

  assert.equal(secondText.toString(), expectedText)
  assert.deepEqual(secondComments.get(expectedComment.id), expectedComment)
  console.log('Two clients converged on shared text and comments.')
} finally {
  firstProvider.destroy()
  secondProvider.destroy()
  firstDocument.destroy()
  secondDocument.destroy()
}