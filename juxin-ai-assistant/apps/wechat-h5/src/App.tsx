import { FormEvent, useEffect, useRef, useState } from 'react'
import { api, Bootstrap, Document, Source } from './api'
import juxinLogo from './assets/juxin-logo.png'

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
  sources?: Source[]
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我是聚信AI客服。你可以直接问我产品、服务或公开资料中的问题；我会依据可公开的资料回答。',
}

const EXAMPLES = ['你们提供哪些服务？', '怎样下载产品资料？', '售后支持怎么联系？']

export default function App() {
  const [quota, setQuota] = useState<Bootstrap | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [question, setQuestion] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([api.bootstrap(), api.documents()])
      .then(([nextQuota, nextDocuments]) => {
        setQuota(nextQuota)
        setDocuments(nextDocuments)
      })
      .catch(error => setError(error instanceof Error ? error.message : '加载失败，请稍后再试'))
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: messages.length > 2 ? 'smooth' : 'auto' })
  }, [messages, busy])

  async function ask(rawQuestion = question) {
    const content = rawQuestion.trim()
    if (!content || busy) return
    setQuestion('')
    setBusy(true)
    setError('')
    setMessages(current => [...current, { id: `user-${Date.now()}`, role: 'user', content }])
    try {
      const result = await api.ask(content)
      setMessages(current => [...current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
      }])
      if (quota) setQuota({ ...quota, hour_remaining: result.hour_remaining, day_remaining: result.day_remaining })
    } catch (error) {
      setError(error instanceof Error ? error.message : '请求失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void ask()
  }

  async function download(file: Document) {
    try {
      location.assign(await api.download(file.file_uuid))
    } catch (error) {
      setError(error instanceof Error ? error.message : '下载失败，请稍后再试')
    }
  }

  return <main className="chat-shell">
    <header className="chat-header">
      <img className="brand-mark" src={juxinLogo} alt="聚信" />
      <div><h1>聚信AI客服</h1><p>仅依据公开资料回答</p></div>
      <button className="documents-trigger" type="button" onClick={() => setDocumentsOpen(true)}>资料</button>
    </header>

    <section className="conversation" aria-label="对话内容">
      <div className="conversation-inner">
        {messages.map(message => <article className={`message ${message.role}`} key={message.id}>
          {message.role === 'assistant' && <img className="message-avatar" src={juxinLogo} alt="" />}
          <div className="message-body">
            <p>{message.content}</p>
            {message.sources && message.sources.length > 0 && <details className="source-list">
              <summary>参考资料 {message.sources.length} 份</summary>
              <ul>{message.sources.map(source => <li key={`${source.file_uuid}-${source.section_title}`}>{source.file_name}{source.section_title ? ` · ${source.section_title}` : ''}</li>)}</ul>
            </details>}
          </div>
        </article>)}
        {messages.length === 1 && !busy && <div className="suggestions" aria-label="示例问题">
          <p>可以这样问</p>
          {EXAMPLES.map(example => <button key={example} type="button" onClick={() => void ask(example)}>{example}</button>)}
        </div>}
        {busy && <article className="message assistant"><img className="message-avatar" src={juxinLogo} alt="" /><div className="thinking"><i /><i /><i /></div></article>}
        <div ref={messagesEnd} />
      </div>
    </section>

    {error && <p className="chat-error" role="alert">{error}</p>}

    <footer className="composer-area">
      {quota && <p className="quota">本小时剩余 {quota.hour_remaining}/{quota.hour_limit} · 今日剩余 {quota.day_remaining}/{quota.day_limit}</p>}
      <form className="composer" onSubmit={submit}>
        <textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} rows={1} placeholder="发消息…" aria-label="向资料助手提问" />
        <button type="submit" disabled={busy || !question.trim()} aria-label="发送消息"><span>↑</span></button>
      </form>
      <p className="disclaimer">AI 回答可能有误，请以正式资料为准。</p>
    </footer>

    {documentsOpen && <div className="documents-sheet" role="dialog" aria-modal="true" aria-label="公开资料下载">
      <button className="sheet-backdrop" type="button" aria-label="关闭资料列表" onClick={() => setDocumentsOpen(false)} />
      <section className="sheet-content">
        <div className="sheet-handle" />
        <div className="sheet-heading"><div><p>公开资料</p><h2>下载中心</h2></div><button type="button" onClick={() => setDocumentsOpen(false)} aria-label="关闭">×</button></div>
        {documents.length === 0 ? <p className="empty-documents">暂时没有可下载的公开资料。</p> : <ul className="document-list">{documents.map(file => <li key={file.file_uuid}><div><strong>{file.file_name}</strong><small>{file.summary || '公开资料'}</small></div><button type="button" onClick={() => void download(file)}>下载</button></li>)}</ul>}
      </section>
    </div>}
  </main>
}
