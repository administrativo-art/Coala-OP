import { defineSecret, defineString } from "firebase-functions/params";

export const metaSystemUserToken = defineSecret("META_SYSTEM_USER_TOKEN");
export const metaGraphApiVersion = defineString("META_GRAPH_API_VERSION", { default: "v25.0" });
export const metaInstagramAccountId = defineString("META_INSTAGRAM_ACCOUNT_ID", {
  default: "17841476184089270",
});
