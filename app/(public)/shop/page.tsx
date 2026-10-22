import { redirect } from "next/navigation";

/** The showroom now lives on the home page. */
export default function ShopRedirect() {
  redirect("/");
}
