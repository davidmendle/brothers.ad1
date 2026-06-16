import AuditForm from "../components/AuditForm";
import {
  capabilities,
  industries,
  packages,
  phoneDisplay,
  phoneHref,
  products,
  testimonials
} from "../lib/content";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <span className="pill">* B2B AI Software & Custom Agents</span>
          <h1>
            Custom AI Agents & Business Automation Software for Companies That Want to{" "}
            <span className="gradient-text">Move Faster</span>
          </h1>
          <p>
            Brothers.ad builds AI sales agents, review protocols, customer service systems, and operating software for
            businesses that want to increase human efficiency without replacing their team.
          </p>
          <div className="hero-actions">
            <a className="btn primary" href="#contact">
              Book AI Automation Audit
            </a>
            <a className="btn secondary" href="#products">
              View AI Products
            </a>
          </div>
          <div className="micro-tags" aria-label="Services">
            <span>Custom AI Agent Development</span>
            <span>AI Software Licensing</span>
            <span>Workflow Automation</span>
            <span>CRM Integration</span>
          </div>
        </div>
      </section>

      <aside className="stats" aria-label="Business results">
        <div className="wrap stats-grid">
          <div className="stat">
            <strong>500+</strong>
            <span>Businesses Automated</span>
          </div>
          <div className="stat">
            <strong>1M+</strong>
            <span>Leads Processed</span>
          </div>
          <div className="stat">
            <strong>98%</strong>
            <span>Client Retention</span>
          </div>
          <div className="stat">
            <strong>24/7</strong>
            <span>AI Agent Availability</span>
          </div>
        </div>
      </aside>

      <section id="products">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">What We Build</p>
            <h2>AI Agents That Handle Real Work</h2>
            <p>
              Our AI systems help businesses respond faster, document better, follow up automatically, manage
              employees, and protect profit margins.
            </p>
          </div>
          <div className="product-grid">
            {products.map((product) => (
              <article className="card" id={product.id} key={product.id}>
                <span className={`icon ${product.color}`}>{product.icon}</span>
                <h3>{product.title}</h3>
                <p>{product.summary}</p>
                <ul className="list">
                  {product.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a className="learn" href="#contact">
                  Learn More
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-alt" id="about">
        <div className="wrap split">
          <div>
            <p className="eyebrow">Why Brothers.ad</p>
            <h2>Turn Your Business Into an AI-Powered Operation Without Replacing Your People</h2>
            <p className="lead">
              We build AI agents that fit into your existing workflows, handle the repetitive work, and free your team
              to focus on what matters: closing deals and delivering great service.
            </p>
            <div className="feature-list">
              {[
                ["Built for Real Workflows", "Agents trained on your business, your customers, and your processes."],
                ["Full Integration", "Connects with your CRM, email, calendar, phone, and existing tools."],
                ["Transparent & Accountable", "Every action is logged so you always know what your AI agents are doing."],
                ["ROI-Focused", "Measured by deals closed, time saved, and revenue grown."]
              ].map(([title, copy]) => (
                <div className="feature" key={title}>
                  <span className="feature-dot">o</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{copy}</p>
                  </div>
                </div>
              ))}
            </div>
            <p>
              <a className="btn primary" href="#contact">
                Book Free AI Audit
              </a>
            </p>
          </div>
          <div className="ai-visual" aria-label="Abstract AI network visual" />
        </div>
      </section>

      <section id="industries">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Industries</p>
            <h2>AI Solutions Built for Your Industry</h2>
            <p>Specialized AI agents that understand your business, your customers, and your workflows.</p>
          </div>
          <div className="industry-grid">
            {industries.map((industry) => (
              <article className="card industry-card" id={industry.id} key={industry.id}>
                <span className="icon">AI</span>
                <h3>{industry.title}</h3>
                <p>{industry.summary}</p>
                <div className="tags">
                  {industry.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-alt" id="pricing">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Pricing</p>
            <h2>AI Automation Packages</h2>
            <p>Choose the package that matches your business needs. All plans include setup, training, and support.</p>
          </div>
          <div className="pricing-grid">
            {packages.map((item) => (
              <article className={`price-card ${item.featured ? "featured" : ""}`} key={item.name}>
                {item.featured ? <span className="badge">Most Popular</span> : null}
                <h3>{item.name}</h3>
                <p>{item.summary}</p>
                <div className="price">
                  {item.price}
                  <small>{item.period}</small>
                </div>
                <ul className="list">
                  {item.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a className={`btn ${item.featured ? "primary" : "secondary"}`} href="#contact">
                  {item.cta}
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="solutions">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Capabilities</p>
            <h2>Everything Your AI Agents Can Do</h2>
          </div>
          <div className="capabilities">
            {capabilities.map((capability) => (
              <span key={capability}>{capability}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="section-alt" id="blog">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Results</p>
            <h2>Businesses Growing With AI</h2>
          </div>
          <div className="testimonials">
            {testimonials.map((testimonial) => (
              <article className="testimonial" key={testimonial.name}>
                <div className="stars">*****</div>
                <p>"{testimonial.quote}"</p>
                <strong>{testimonial.name}</strong>
                <span>{testimonial.company}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <aside className="keyword-band">
        <div className="wrap">
          Brothers.ad delivers B2B AI software including AI agents for business, custom AI agents, business automation
          software, AI workflow automation, AI operating system for business, AI sales automation, AI customer service
          agents, AI receptionist for business, AI lead follow-up system, and AI CRM automation.
        </div>
      </aside>

      <section className="contact-section" id="contact">
        <div className="wrap contact-grid">
          <div className="audit-card">
            <span className="audit-icon">AI</span>
            <h2>Book Your Free AI Automation Audit</h2>
            <p className="lead">
              We will analyze your workflows, identify automation opportunities, and show you exactly where AI can save
              time and grow revenue.
            </p>
            <div className="audit-actions">
              <a className="btn secondary" href={phoneHref}>
                Call {phoneDisplay}
              </a>
            </div>
            <p className="lead">Free consultation | Custom roadmap | No obligation</p>
          </div>
          <AuditForm />
        </div>
      </section>

      <section className="final-cta">
        <div className="wrap">
          <h2>Ready to Automate Your Business?</h2>
          <p>Book a free AI Automation Audit and see exactly where AI can save you time and money.</p>
          <a className="btn white" href="#contact">
            Book My AI Audit
          </a>
        </div>
      </section>
    </main>
  );
}
