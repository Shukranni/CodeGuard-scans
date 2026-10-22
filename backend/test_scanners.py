import os
import sys
import json

# Add backend directory to Python path so we can import our services
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from scans.services.scanner_runner import ScannerRunner

def main():
    # We will just test it on your root CodeGuard project folder
    target_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    
    print(f"Testing scanners on directory: {target_dir}")
    print("This might take a few seconds...\n")
    
    runner = ScannerRunner(target_dir, ['gitleaks', 'dependency', 'semgrep'])
    results = runner.run_all()

    # Pretty print the results
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
