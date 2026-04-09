// Windows Firewall — ensure TIMEFLOW LAN ports are allowed.
// Called once at daemon startup. Silently succeeds if rules already exist
// or if the process lacks elevation (logs a warning instead).

use std::os::windows::process::CommandExt;
use std::process::Command;

struct FirewallRule {
    name: &'static str,
    protocol: &'static str,
    port: u16,
    direction: &'static str,
}

const RULES: &[FirewallRule] = &[
    FirewallRule { name: "TIMEFLOW LAN Discovery (UDP In)",  protocol: "UDP", port: 47892, direction: "in"  },
    FirewallRule { name: "TIMEFLOW LAN Discovery (UDP Out)", protocol: "UDP", port: 47892, direction: "out" },
    FirewallRule { name: "TIMEFLOW LAN Server (TCP In)",     protocol: "TCP", port: 47891, direction: "in"  },
    FirewallRule { name: "TIMEFLOW LAN Server (TCP Out)",    protocol: "TCP", port: 47891, direction: "out" },
];

fn rule_exists(name: &str) -> bool {
    Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", &format!("name={}", name)])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if the rule already has profile=Any (no need to recreate).
fn rule_has_correct_profile(name: &str) -> bool {
    Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", &format!("name={}", name)])
        .creation_flags(0x08000000)
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout).to_ascii_lowercase();
            stdout.contains("profiles:") && stdout.contains("any")
        })
        .unwrap_or(false)
}

fn delete_rule(name: &str) {
    let _ = Command::new("netsh")
        .args(["advfirewall", "firewall", "delete", "rule", &format!("name={}", name)])
        .creation_flags(0x08000000)
        .output();
}

fn add_rule(rule: &FirewallRule) -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut args = vec![
        "advfirewall".to_string(),
        "firewall".to_string(),
        "add".to_string(),
        "rule".to_string(),
        format!("name={}", rule.name),
        format!("dir={}", rule.direction),
        "action=allow".to_string(),
        format!("protocol={}", rule.protocol),
        format!("localport={}", rule.port),
        "enable=yes".to_string(),
        "profile=any".to_string(),
    ];

    if !exe_path.is_empty() {
        args.push(format!("program={}", exe_path));
    }

    let output = Command::new("netsh")
        .args(&args)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("Failed to run netsh: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("netsh failed ({}): {}", output.status, stderr.trim()))
    }
}

/// Ensure all TIMEFLOW firewall rules exist with correct settings.
/// Deletes and recreates rules to ensure profile=any (fixes stale rules from older versions).
pub fn ensure_firewall_rules() {
    // Always delete and recreate to ensure correct profile (older versions used private,domain)
    let mut recreated = 0;
    let mut created = 0;

    for rule in RULES {
        if rule_exists(rule.name) {
            if rule_has_correct_profile(rule.name) {
                // Rule exists with correct profile — skip recreation
                continue;
            }
            delete_rule(rule.name);
            match add_rule(rule) {
                Ok(()) => {
                    recreated += 1;
                    log::info!("Firewall: recreated rule '{}' (profile=any)", rule.name);
                }
                Err(e) => log::warn!("Firewall: cannot recreate '{}' — {}", rule.name, e),
            }
        } else {
            match add_rule(rule) {
                Ok(()) => {
                    created += 1;
                    log::info!("Firewall: added rule '{}'", rule.name);
                }
                Err(e) => log::warn!(
                    "Firewall: cannot add '{}' — {}. LAN discovery may not work. \
                     Run the daemon as administrator once, or manually allow UDP {} and TCP {} in Windows Firewall.",
                    rule.name, e, 47892, 47891
                ),
            }
        }
    }

    if recreated > 0 {
        log::info!("Firewall: recreated {} rule(s), created {} new", recreated, created);
    } else if created > 0 {
        log::info!("Firewall: created {} new rule(s)", created);
    } else {
        log::info!("Firewall: all {} rules up to date", RULES.len());
    }
}
