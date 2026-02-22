#!/bin/sh
# ===================================================================
# Kong Initialization: Ersetzt $SUPABASE_ANON_KEY und $SUPABASE_SERVICE_KEY
# in der kong.yml-Konfiguration (sicherer als eval/envsubst).
#
# Verwendet Perl (in Kong 2.8.x verfügbar) statt eval/echo oder envsubst
# um Probleme mit Glob-Expansion, Quotes in YAML zu vermeiden.
# ===================================================================

perl -pe \
  's/\$SUPABASE_ANON_KEY/$ENV{SUPABASE_ANON_KEY}/g;
   s/\$SUPABASE_SERVICE_KEY/$ENV{SUPABASE_SERVICE_KEY}/g' \
  /home/kong/temp.yml > /home/kong/kong.yml

exec /docker-entrypoint.sh kong docker-start
