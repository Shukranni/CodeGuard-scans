# CodeGuard Project Requirements & Setup Guide

This document provides a comprehensive list of requirements and step-by-step instructions to set up and run the CodeGuard project locally.

## 📋 System Prerequisites

Ensure you have the following installed on your system:
- **Node.js**: v18.x or higher (Recommended)
- **npm**: v8.x or higher (Usually bundled with Node.js)
- **Python**: v3.13 (As specified in `Pipfile`)
- **Pipenv**: Python dependency management tool (`pip install pipenv`)
- **Git**: For cloning and managing the repository

---

## 🛠️ Third-Party Security Scanners

CodeGuard relies on external security scanners that must be available in your system path.

### 1. Semgrep (SAST)
Used for static analysis of code for security vulnerabilities.
```bash
pip install semgrep
# or on macOS (requires Homebrew)
brew install semgrep
```

### 2. Gitleaks (Secret Detection)
Used to detect secrets like API keys and passwords in the codebase.
- **Windows**: `scoop install gitleaks` or download from [GitHub Releases](https://github.com/gitleaks/gitleaks/releases)
- **Linux/macOS**: `brew install gitleaks` or `apt install gitleaks`

### 3. npm audit (SCA)
Used to check for vulnerabilities in Node.js dependencies.
(Automatically included with npm installation)

---

## 💻 Frontend Setup (React/Vite)

The frontend is located in the root directory.

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Environment Configuration**:
    Create a `.env` file in the root directory and add the following keys:
    ```env
    # AI Engine Keys
    VITE_OPENAI_API_KEY=your-openai-key-here
    VITE_GEMINI_API_KEY=your-gemini-key-here
    VITE_ANTHROPIC_API_KEY=your-anthropic-key-here
    VITE_PERPLEXITY_API_KEY=your-perplexity-key-here

    # Database & Services
    VITE_SUPABASE_URL=https://your-supabase-url.co
    VITE_SUPABASE_ANON_KEY=your-supabase-key-here

    # Analytics & Ads
    VITE_GOOGLE_ANALYTICS_ID=your-ga-id-here
    VITE_ADSENSE_ID=your-adsense-id-here
    VITE_STRIPE_PUBLISHABLE_KEY=your-stripe-key-here
    ```
3.  **Run Development Server**:
    ```bash
    npm run dev
    ```
    The frontend will be accessible at `http://localhost:4028`.

---

## 🐍 Backend Setup (Django)

The backend is located in the `backend/` directory.

1.  **Initialize Virtual Environment**:
    From the root directory:
    ```bash
    pipenv install
    pipenv shell
    ```
2.  **Database Migration**:
    From the `backend/` directory:
    ```bash
    python manage.py migrate
    ```
3.  **Create Superuser** (Optional, for admin access):
    ```bash
    python manage.py createsuperuser
    ```
4.  **Run Backend Server**:
    ```bash
    python manage.py runserver
    ```
    The backend API will be accessible at `http://127.0.0.1:8000`.

---

## 🚀 Running the Full Stack

To run the entire application simultaneously:
1.  Open a terminal in the root and run `npm run dev`.
2.  Open another terminal in the root, run `pipenv shell`, navigate to `backend/`, and run `python manage.py runserver`.

## ⚠️ Troubleshooting

- **CORS Issues**: Ensure `CORS_ALLOWED_ORIGINS` in `backend/backend/settings.py` includes your frontend URL (`http://localhost:4028`).
- **Scanner Not Found**: If a scan fails with a "not found" error, ensure `semgrep` and `gitleaks` are correctly installed and added to your system's PATH.
- **Port Conflicts**: If port 4028 or 8000 is occupied, you may need to adjust the configuration in `vite.config.mjs` or run Django on a different port using `python manage.py runserver 8001`.
