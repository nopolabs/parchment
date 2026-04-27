// Extends the wrangler-generated Env with secrets that wrangler cannot introspect.
// Add one entry here whenever a new site's ISSUE_API_KEY secret is added.
interface Env {
  RESEND_API_KEY:      string;
  MTW_ISSUE_API_KEY:   string;
  BBPP_ISSUE_API_KEY:  string;
}
