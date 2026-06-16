import AdminBlogDashboard from "../../components/AdminBlogDashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Login",
  description: "Sign in to the Brothers.ad publishing dashboard.",
  robots: {
    index: false,
    follow: false
  }
};

export default function LoginPage() {
  return <AdminBlogDashboard />;
}
