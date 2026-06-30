import AdminBlogDashboard from "../../components/AdminBlogDashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Login",
  description: "Secure Brothers.ad blog publishing dashboard.",
  robots: {
    index: false,
    follow: false
  }
};

export default function AdminPage() {
  return <AdminBlogDashboard />;
}
