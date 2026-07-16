import "./globals.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import ChatWidget from "../components/ChatWidget";
import { siteUrl } from "../lib/siteConfig";
import { sanitizeJsonForDom } from "../lib/securityUtils";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Brothers.ad | Custom AI Agents & Business Automation Software",
    template: "%s | Brothers.ad"
  },
  description:
    "B2B AI software, custom AI agents, workflow automation, AI sales automation, customer service agents, and AI operating systems for business.",
  keywords: [
    "custom AI agents",
    "AI business automation",
    "AI workflow automation",
    "AI sales automation",
    "AI CRM automation",
    "AI customer service agent",
    "AI lead follow-up system",
    "AI review automation",
    "business automation software",
    "Brothers.ad"
  ],
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Brothers.ad | Custom AI Agents & Business Automation Software",
    description:
      "Custom AI agents, sales follow-up systems, review protocols, and AI operations software for companies that want to move faster.",
    url: siteUrl,
    siteName: "Brothers.ad",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Brothers.ad | Custom AI Agents & Business Automation Software",
    description:
      "Custom AI agents, workflow automation, sales follow-up systems, review protocols, and AI operations software."
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1
    }
  }
};

export default function RootLayout({ children }) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Brothers.ad",
    url: siteUrl,
    logo: `${siteUrl}/logo.png`,
    telephone: "+18576360833",
    sameAs: ["https://www.brothersrestoration.org/"],
    makesOffer: [
      "Custom AI agents",
      "AI sales automation",
      "AI workflow automation",
      "AI customer service systems",
      "AI review automation"
    ]
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Brothers.ad",
    url: siteUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/blog?query={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };

  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: sanitizeJsonForDom(organizationJsonLd) }}
        />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: sanitizeJsonForDom(websiteJsonLd) }} />
        <Header />
        {children}
        <Footer />
        <ChatWidget />
      </body>
    </html>
  );
}
