default:
	sh ./build.sh

sign:
	sh ./sign.sh

rename:
	sh ./rename.sh

feature:
	@current_version=$$(grep '"version":' src/manifest.json | sed 's/.*"version": "\([^"]*\)".*/\1/'); \
	major=$$(echo $$current_version | cut -d. -f1); \
	minor=$$(echo $$current_version | cut -d. -f2); \
	new_minor=$$(($$minor + 1)); \
	new_version="$$major.$$new_minor.0"; \
	echo "Bumping version from $$current_version to $$new_version"; \
	sed -i.bak 's/"version": "[^"]*"/"version": "'$$new_version'"/' src/manifest.json && rm src/manifest.json.bak

patch:
	@current_version=$$(grep '"version":' src/manifest.json | sed 's/.*"version": "\([^"]*\)".*/\1/'); \
	major=$$(echo $$current_version | cut -d. -f1); \
	minor=$$(echo $$current_version | cut -d. -f2); \
	patch=$$(echo $$current_version | cut -d. -f3); \
	new_patch=$$(($$patch + 1)); \
	new_version="$$major.$$minor.$$new_patch"; \
	echo "Bumping version from $$current_version to $$new_version"; \
	sed -i.bak 's/"version": "[^"]*"/"version": "'$$new_version'"/' src/manifest.json && rm src/manifest.json.bak