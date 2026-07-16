import Brand from "./Brand";
import { email, phoneDisplay, phoneHref } from "../lib/content";

export default function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <a href="/" aria-label="Brothers.ad home">
              <Brand />
            </a>
            <p>
              Brothers.ad builds practical AI systems for sales, service, documentation, reputation, and operations so
              growing teams can work with more consistency and control.
            </p>
            <a href={`mailto:${email}`}>{email}</a>
            <a href={phoneHref}>{phoneDisplay}</a>
            <a href="https://brothersrestoration.org/">Brothers Restoration</a>
          </div>
          <div>
            <h3>AI Products</h3>
            <a href="/#sales-agent">AI Sales Agent</a>
            <a href="/#review-protocol">AI Review Protocol</a>
            <a href="/#customer-service">AI Customer Service</a>
            <a href="/#operations-os">AI Operations OS</a>
            <a href="/#marketing-agent">AI Marketing Agent</a>
            <a href="/#documentation">AI Documentation</a>
          </div>
          <div>
            <h3>Solutions</h3>
            <a href="/#industries">For Contractors</a>
            <a href="/#industries">For Restoration</a>
            <a href="/#industries">For Property Mgmt</a>
            <a href="/#industries">For Local Business</a>
            <a href="/#industries">For Enterprise</a>
          </div>
          <div>
            <h3>Company</h3>
            <a href="/#about">About Us</a>
            <a href="/blog">Blog</a>
            <a href="/#contact">Contact</a>
            <a href="https://brothersrestoration.org/">Brothers Restoration</a>
            <a href="/login">Admin Login</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>(c) 2026 Brothers.ad. All rights reserved.</span>
          <span>
            <a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
