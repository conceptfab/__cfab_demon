use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Instant;

const WINDOW_SECS: u64 = 60;
const MAX_ATTEMPTS: u32 = 10;

pub struct PairThrottle {
    attempts: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

impl PairThrottle {
    pub fn new() -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
        }
    }

    pub fn check_and_record(&self, ip: IpAddr) -> Result<(), &'static str> {
        let mut attempts = self.attempts.lock().unwrap();
        let now = Instant::now();
        let entry = attempts.entry(ip).or_insert((0, now));

        if now.duration_since(entry.1).as_secs() > WINDOW_SECS {
            *entry = (1, now);
            return Ok(());
        }

        if entry.0 >= MAX_ATTEMPTS {
            log::warn!(
                "[LAN][SEC] pair throttle: IP {} exceeded {} attempts in {}s",
                ip,
                MAX_ATTEMPTS,
                WINDOW_SECS
            );
            return Err("too many attempts");
        }

        entry.0 += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::PairThrottle;
    use std::net::IpAddr;

    #[test]
    fn pair_throttle_blocks_after_10_attempts_per_ip() {
        let throttle = PairThrottle::new();
        let ip: IpAddr = "192.168.1.50".parse().unwrap();

        for _ in 0..10 {
            assert!(throttle.check_and_record(ip).is_ok());
        }

        assert!(
            throttle.check_and_record(ip).is_err(),
            "11th attempt from same IP must be throttled"
        );
    }

    #[test]
    fn pair_throttle_per_ip_isolated() {
        let throttle = PairThrottle::new();
        let ip1: IpAddr = "192.168.1.50".parse().unwrap();
        let ip2: IpAddr = "192.168.1.51".parse().unwrap();

        for _ in 0..10 {
            let _ = throttle.check_and_record(ip1);
        }

        assert!(throttle.check_and_record(ip2).is_ok());
    }
}
