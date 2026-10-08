// Authsome settings fixture, transcribed from plugins/* settings.Define declarations.
// Keep keys, defaults, and scopes aligned with the sibling Authsome repository.
export const authsomeSettingsCatalog = {
  "anomaly": [
    {
      "key": "anomaly.min_login_history",
      "label": "Minimum Login History",
      "category": "Anomaly Detection",
      "description": "Minimum number of logins before anomaly detection kicks in",
      "default": 10,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "anomaly.risk_threshold",
      "label": "Risk Threshold",
      "category": "Anomaly Detection",
      "description": "Score above which an anomaly alert is raised (0-100)",
      "default": 70,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "anomaly.enable_time_anomaly",
      "label": "Enable Time Anomaly",
      "category": "Anomaly Detection",
      "description": "Enable detection of unusual login times",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "anomaly.enable_geo_anomaly",
      "label": "Enable Geo Anomaly",
      "category": "Anomaly Detection",
      "description": "Enable detection of logins from new countries",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "apikey": [
    {
      "key": "apikey.max_keys_per_user",
      "label": "Max Keys Per User",
      "category": "API Keys",
      "description": "Maximum number of active API keys per user (0 = unlimited)",
      "default": 0,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "apikey.default_expiry_seconds",
      "label": "Default Key Expiry (seconds)",
      "category": "API Keys",
      "description": "Default TTL for newly created API keys in seconds (0 = no expiry)",
      "default": 0,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "deviceverify": [
    {
      "key": "deviceverify.notify_on_new_device",
      "label": "Notify on New Device",
      "category": "Device Verification",
      "description": "Send a notification when a new device is detected",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "deviceverify.challenge_ttl_minutes",
      "label": "Challenge TTL (minutes)",
      "category": "Device Verification",
      "description": "How long a device verification challenge is valid, in minutes",
      "default": 10,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "email": [
    {
      "key": "email.from_address",
      "label": "From Address",
      "category": "Email",
      "description": "Default sender email address for outgoing emails",
      "default": "noreply@authsome.local",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "email.app_name",
      "label": "Application Name",
      "category": "Email",
      "description": "Application name used in email subjects and bodies",
      "default": "AuthSome",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "email.base_url",
      "label": "Base URL",
      "category": "Email",
      "description": "Application root URL for building links in emails",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "geofence": [
    {
      "key": "geofence.default_policy",
      "label": "Default Policy",
      "category": "Geofencing",
      "description": "Default access policy when no country rules match",
      "default": "allow_all",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "geofence.allowed_countries",
      "label": "Allowed Countries",
      "category": "Geofencing",
      "description": "ISO 3166-1 alpha-2 country codes allowed",
      "default": [],
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "geofence.blocked_countries",
      "label": "Blocked Countries",
      "category": "Geofencing",
      "description": "ISO 3166-1 alpha-2 country codes blocked",
      "default": [],
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "geofence.block_message",
      "label": "Block Message",
      "category": "Geofencing",
      "description": "Error message shown when access is denied by geofence rules",
      "default": "access denied based on location",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "geoip": [
    {
      "key": "geoip.cache_ttl_hours",
      "label": "Cache TTL (hours)",
      "category": "GeoIP",
      "description": "How long GeoIP lookup results are cached, in hours",
      "default": 24,
      "scopes": [
        "global"
      ],
      "sensitive": false
    }
  ],
  "impossibletravel": [
    {
      "key": "impossibletravel.max_speed_kmh",
      "label": "Max Speed (km/h)",
      "category": "Impossible Travel",
      "description": "Maximum plausible travel speed in km/h",
      "default": 900.0,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "impossibletravel.min_distance_km",
      "label": "Min Distance (km)",
      "category": "Impossible Travel",
      "description": "Minimum distance in km between logins to trigger check",
      "default": 500.0,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "impossibletravel.lookback_window_hours",
      "label": "Lookback Window (hours)",
      "category": "Impossible Travel",
      "description": "How far back to look for previous logins, in hours",
      "default": 24,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "impossibletravel.action",
      "label": "Detection Action",
      "category": "Impossible Travel",
      "description": "Action to take when impossible travel is detected",
      "default": "flag",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "ipreputation": [
    {
      "key": "ipreputation.block_threshold",
      "label": "Block Threshold",
      "category": "IP Reputation",
      "description": "Score at or above which IPs are blocked",
      "default": 80,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "ipreputation.warn_threshold",
      "label": "Warn Threshold",
      "category": "IP Reputation",
      "description": "Score at or above which IPs are flagged with a warning",
      "default": 50,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "ipreputation.cache_ttl_hours",
      "label": "Cache TTL (Hours)",
      "category": "IP Reputation",
      "description": "How long IP reputation results are cached",
      "default": 6,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "ipreputation.block_message",
      "label": "Block Message",
      "category": "IP Reputation",
      "description": "Error message shown when an IP is blocked",
      "default": "access denied due to IP reputation",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "magiclink": [
    {
      "key": "magiclink.token_ttl_seconds",
      "label": "Token TTL (seconds)",
      "category": "Magic Link",
      "description": "Lifetime of magic link tokens in seconds",
      "default": 600,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "magiclink.session_token_ttl_seconds",
      "label": "Session Token TTL (seconds)",
      "category": "Magic Link",
      "description": "Lifetime of sessions created via magic link in seconds",
      "default": 3600,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "magiclink.session_refresh_ttl_seconds",
      "label": "Refresh Token TTL (seconds)",
      "category": "Magic Link",
      "description": "Lifetime of refresh tokens for magic link sessions in seconds",
      "default": 2592000,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "mfa": [
    {
      "key": "mfa.issuer",
      "label": "Issuer Name",
      "category": "Multi-Factor Auth",
      "description": "Name shown in authenticator apps (e.g. Google Authenticator)",
      "default": "AuthSome",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "notification": [
    {
      "key": "notification.app_name",
      "label": "Application Name",
      "category": "Notifications",
      "description": "Application name used in notification templates",
      "default": "AuthSome",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "notification.base_url",
      "label": "Base URL",
      "category": "Notifications",
      "description": "Application root URL for building links in notifications",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "notification.default_locale",
      "label": "Default Locale",
      "category": "Notifications",
      "description": "Default locale for notification templates",
      "default": "en",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "notification.async",
      "label": "Async Delivery",
      "category": "Notifications",
      "description": "Send notifications asynchronously via dispatch queue",
      "default": false,
      "scopes": [
        "global"
      ],
      "sensitive": false
    }
  ],
  "passkey": [
    {
      "key": "passkey.rp_display_name",
      "label": "RP Display Name",
      "category": "Passkey / WebAuthn",
      "description": "Relying party display name shown to users during WebAuthn ceremonies",
      "default": "AuthSome",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "passkey.rp_id",
      "label": "RP ID",
      "category": "Passkey / WebAuthn",
      "description": "Relying party identifier (typically the domain name)",
      "default": "localhost",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "passkey.rp_origins",
      "label": "RP Origins",
      "category": "Passkey / WebAuthn",
      "description": "Allowed origins for WebAuthn ceremonies (e.g. https://app.example.com)",
      "default": [],
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "passkey.session_timeout_seconds",
      "label": "Ceremony Timeout (seconds)",
      "category": "Passkey / WebAuthn",
      "description": "How long a WebAuthn ceremony session lives in seconds",
      "default": 300,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "password": [
    {
      "key": "password.min_length",
      "label": "Minimum Password Length",
      "category": "Password Policy",
      "description": "Minimum number of characters required for passwords",
      "default": 8,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "password.require_special",
      "label": "Require Special Character",
      "category": "Password Policy",
      "description": "Require at least one special character in passwords",
      "default": false,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "password.allowed_domains",
      "label": "Allowed Email Domains",
      "category": "Password Policy",
      "description": "Comma-separated list of allowed email domains for signup (empty = all allowed)",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "phone": [
    {
      "key": "phone.code_ttl_seconds",
      "label": "OTP Code TTL (seconds)",
      "category": "Phone Auth",
      "description": "Lifetime of OTP verification codes in seconds",
      "default": 300,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "phone.auto_create",
      "label": "Auto-Create Users",
      "category": "Phone Auth",
      "description": "Automatically create new users when an unregistered phone number is used",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "riskengine": [
    {
      "key": "riskengine.low_threshold",
      "label": "Low Threshold",
      "category": "Risk Engine",
      "description": "Score below which risk is considered low",
      "default": 30,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "riskengine.medium_threshold",
      "label": "Medium Threshold",
      "category": "Risk Engine",
      "description": "Score below which risk is considered medium",
      "default": 60,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "riskengine.high_threshold",
      "label": "High Threshold",
      "category": "Risk Engine",
      "description": "Score at or above which risk is considered high and action is taken",
      "default": 85,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "riskengine.block_message",
      "label": "Block Message",
      "category": "Risk Engine",
      "description": "Error message shown when access is blocked due to high risk score",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "scim": [
    {
      "key": "scim.enabled",
      "label": "Enable SCIM Provisioning",
      "category": "SCIM",
      "description": "Enable SCIM 2.0 endpoints for automated user and group provisioning",
      "default": false,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "scim.auto_create_users",
      "label": "Auto-Create Users",
      "category": "SCIM",
      "description": "Automatically create new users when provisioned via SCIM",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "scim.auto_suspend_users",
      "label": "Auto-Suspend Deprovisioned Users",
      "category": "SCIM",
      "description": "Automatically suspend users when deactivated via SCIM",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "scim.group_sync",
      "label": "Sync SCIM Groups to Teams",
      "category": "SCIM",
      "description": "Map SCIM Group resources to organization teams",
      "default": false,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "scim.default_role",
      "label": "Default Member Role",
      "category": "SCIM",
      "description": "Default organization role assigned to SCIM-provisioned users",
      "default": "member",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "scim.token_expiry_days",
      "label": "Token Expiry (days)",
      "category": "SCIM",
      "description": "Default expiry period for new SCIM bearer tokens (0 = no expiry)",
      "default": 365,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "sharedsignals": [
    {
      "key": "sharedsignals.enabled",
      "label": "Shared Signals Enabled",
      "category": "Shared Signals",
      "description": "Accept inbound CAEP events from configured streams",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "sharedsignals.signal_ttl_hours",
      "label": "Signal TTL (hours)",
      "category": "Shared Signals",
      "description": "How long a received CAEP signal keeps influencing the risk score",
      "default": 24,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "sharedsignals.max_actions_per_hour",
      "label": "Max Actions Per Hour",
      "category": "Shared Signals",
      "description": "Actions one stream may take in an hour before it is paused",
      "default": 100,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "sharedsignals.risk_weight",
      "label": "Risk Weight",
      "category": "Shared Signals",
      "description": "Weight the risk engine applies to CAEP signals",
      "default": 2,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "sharedsignals.max_risk_score",
      "label": "Max Risk Score",
      "category": "Shared Signals",
      "description": "Highest score a Shared Signals event may contribute",
      "default": 84,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "social": [
    {
      "key": "social.session_token_ttl_seconds",
      "label": "Session Token TTL (seconds)",
      "category": "Social OAuth",
      "description": "Lifetime of sessions created via social sign-in in seconds",
      "default": 3600,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "social.session_refresh_ttl_seconds",
      "label": "Refresh Token TTL (seconds)",
      "category": "Social OAuth",
      "description": "Lifetime of refresh tokens for social sign-in sessions in seconds",
      "default": 2592000,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "social.providers",
      "label": "Social Providers",
      "category": "Social OAuth",
      "description": "Social OAuth providers configured via dashboard",
      "default": [],
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": true
    },
    {
      "key": "auth.allowed_frontend_urls",
      "label": "Allowed Frontend URLs",
      "category": "Authentication",
      "description": "Comma-separated origins (scheme://host[:port]) that may be used as frontend_url or redirect_url targets.",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "sso": [
    {
      "key": "sso.session_token_ttl_seconds",
      "label": "Session Token TTL (seconds)",
      "category": "SSO",
      "description": "Lifetime of sessions created via SSO sign-in in seconds",
      "default": 3600,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "sso.session_refresh_ttl_seconds",
      "label": "Refresh Token TTL (seconds)",
      "category": "SSO",
      "description": "Lifetime of refresh tokens for SSO sessions in seconds",
      "default": 2592000,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "subscription": [
    {
      "key": "subscription.default_plan",
      "label": "Default Plan",
      "category": "Subscription",
      "description": "Plan slug to auto-assign to new tenants",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "subscription.tenant_mode",
      "label": "Tenant Mode",
      "category": "Subscription",
      "description": "Whether subscriptions are scoped to organizations or individual users",
      "default": "organization",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "subscription.auto_subscribe_org",
      "label": "Auto-Subscribe Organizations",
      "category": "Subscription",
      "description": "Automatically create a subscription when an organization is created",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "subscription.auto_subscribe_user",
      "label": "Auto-Subscribe Users",
      "category": "Subscription",
      "description": "Automatically create a subscription when a user signs up",
      "default": false,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "subscription.trial_days",
      "label": "Trial Period (days)",
      "category": "Subscription",
      "description": "Number of trial days for new subscriptions (0 = no trial)",
      "default": 14,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "subscription.self_service_upgrade",
      "label": "Allow Self-Service Plan Changes",
      "category": "Subscription",
      "description": "Allow users/orgs to upgrade or downgrade their own plan",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "subscription.grace_period_days",
      "label": "Grace Period (days)",
      "category": "Subscription",
      "description": "Days after billing failure before restricting access",
      "default": 3,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ],
  "vpndetect": [
    {
      "key": "vpndetect.block_vpn",
      "label": "Block VPN",
      "category": "VPN Detection",
      "description": "Block authentication attempts from VPN connections",
      "default": false,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "vpndetect.block_proxy",
      "label": "Block Proxy",
      "category": "VPN Detection",
      "description": "Block authentication attempts from proxy connections",
      "default": false,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "vpndetect.block_tor",
      "label": "Block Tor",
      "category": "VPN Detection",
      "description": "Block authentication attempts from Tor exit nodes",
      "default": true,
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    },
    {
      "key": "vpndetect.block_message",
      "label": "Block Message",
      "category": "VPN Detection",
      "description": "Error message shown when access is blocked due to VPN/proxy/Tor detection",
      "default": "",
      "scopes": [
        "global",
        "app"
      ],
      "sensitive": false
    }
  ]
}
