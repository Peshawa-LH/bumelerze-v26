import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * The short event link the app shares, `app.bumelerze.com/e/<id>` (D-1):
 * straight on to the event page, replacing this entry so Back never returns
 * to the alias. The event route accepts a `bml` id or a provider id.
 */
export default function ShortEventLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/event/[id]", params: { id: id ?? "" } }} />;
}
