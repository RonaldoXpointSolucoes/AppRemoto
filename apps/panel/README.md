# Remote Panel

The panel embeds its public connection settings in the browser bundle. Configure all three values as Coolify build variables, not only runtime variables:

- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
- `NEXT_PUBLIC_API_BASE_URL`

Each URL must be an absolute HTTPS URL without credentials, query parameters, or fragments. The production build runs the configuration gate before `next build`; a missing or invalid value stops the image build.
