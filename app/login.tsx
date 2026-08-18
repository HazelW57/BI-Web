"use client";

import { FormEvent, useState } from "react";

export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
    });
    if (response.ok) {
      location.href = "/portal";
      return;
    }
    setError("邮箱或密码不正确，或此邮箱尚未获得访问权限。");
    setBusy(false);
  }

  return <main className="gate">
    <span className="sr-only">SAP BI</span>
    <section className="gate-copy">
      <div className="brand"><img src="/saphiant-logo.png" alt="Saphiant" /></div>
      <p className="eyebrow">INTERNAL COMMERCE INTELLIGENCE</p>
      <h1>One view.<br />Every decision.</h1>
      <p className="lede">聚合销售、利润、成本与退货数据，让管理层在一个可信的经营视图中快速判断。</p>
      <div className="gate-proof"><span>LIVE DATA</span><span>SKU INTELLIGENCE</span><span>MANAGEMENT P&amp;L</span></div>
    </section>
    <section className="gate-card">
      <div className="secure">● SAPHIANT 内部访问</div>
      <h2>登录 BI 系统</h2>
      <p>使用已授权的企业邮箱进入 Commerce Intelligence。</p>
      <form className="login-form" method="post" action="/api/login" onSubmit={submit}>
        <label>邮箱<input name="email" type="email" autoComplete="username" required placeholder="name@saphiant.com" /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <div className="login-error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "正在验证…" : <>安全登录 <span>→</span></>}</button>
      </form>
      <small>有问题请联系：hazel.w@saphiant.com</small>
    </section>
  </main>;
}
