import BrothersOsShell from "../components/BrothersOsShell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Brothers OS",
  description: "Secure Brothers Restoration operating system.",
  robots: {
    index: false,
    follow: false
  }
};

export default function HomePage() {
  return <BrothersOsShell />;
}
