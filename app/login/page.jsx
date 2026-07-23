import BrothersOsShell from "../../components/BrothersOsShell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Brothers OS Login",
  description: "Secure Brothers Restoration operating system login.",
  robots: {
    index: false,
    follow: false
  }
};

export default function LoginPage() {
  return <BrothersOsShell />;
}
