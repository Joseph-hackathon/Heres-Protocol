# GitBook Publishing Guide

This folder is ready to import into GitBook as a documentation space.

## Option 1: GitHub Sync

Recommended for keeping docs updated with the codebase.

1. Push the repository to GitHub.
2. In GitBook, create a new space.
3. Choose **Synchronize with GitHub**.
4. Select this repository.
5. Set the docs root directory to:

```text
gitbook
```

6. GitBook will use `SUMMARY.md` for navigation.
7. Publish the space.
8. Add the GitBook public link to your website navigation.

## Option 2: Manual Import

Use this when you do not want to connect GitHub.

1. Open the `gitbook` folder.
2. Copy the Markdown files into GitBook pages.
3. Use the order from `SUMMARY.md`.
4. Upload images or diagrams separately if you add them later.
5. Publish the space.

## Suggested Website Placement

Use clear navigation labels:

- Docs
- Help Center
- Developer Docs
- Protocol Guide

Recommended top-level website links:

- **Create Capsule** -> your app `/create`
- **Dashboard** -> your app `/dashboard`
- **Docs** -> GitBook public URL
- **GitHub** -> repository URL

## Custom Domain

In GitBook:

1. Open the space settings.
2. Go to custom domains.
3. Add a docs subdomain such as:

```text
docs.yourdomain.com
```

4. Add the DNS records GitBook provides.
5. Wait for SSL provisioning.

## Keeping Docs Professional

Before publishing:

- Replace placeholder repository links.
- Confirm the deployed network.
- Confirm the program ID.
- Confirm fees.
- Confirm supported assets.
- Add contact or support links.
- Add legal, privacy, and risk notices reviewed for your jurisdiction.
- Remove Devnet-only instructions from production user pages if needed.

## Recommended GitBook Settings

- Enable search.
- Enable page feedback if available.
- Add your logo and brand colors.
- Use a short public space title: `Heres Docs`.
- Keep developer pages in a separate section from user help pages.

