#!/bin/bash
# Development environment setup script

set -e

echo "🔧 Setting up Amazon Ads Assistant..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✓ Node.js $(node --version) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Setup environment
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local from .env.example..."
    cp .env.example .env.local
    echo "⚠️  Please fill in .env.local with your configuration"
fi

# Setup git hooks
echo "🔗 Setting up git hooks..."
mkdir -p .git/hooks

# Pre-commit hook for linting
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
npm run lint -- --fix
EOF
chmod +x .git/hooks/pre-commit

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env.local with your configuration"
echo "  2. Run 'npm run dev' to start development server"
echo "  3. Open http://localhost:3000 in your browser"
