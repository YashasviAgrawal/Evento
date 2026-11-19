/**
 * The API client lives in the shared `@tixit/session` package so every Tixit
 * app talks to the API — and holds the single sign-on session — the same way.
 */
export {
  ApiError,
  API_URL,
  api,
  authorizedFetch,
  downloadFile,
  fetchPrivateFile,
  fetchPublic,
  fetchPublicPaged,
  uploadForm,
  type PageMeta,
} from '@tixit/session';
